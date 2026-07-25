#!/usr/bin/env bash
set +x
set -Eeuo pipefail

readonly DEFAULT_KEY_PATH="${HOME}/.ssh/id_ed25519_opensearch_codex"
readonly SSH_CONFIG="${HOME}/.ssh/config"
readonly CONFIG_BEGIN="# BEGIN CODEX OPENSEARCH ACCESS"
readonly CONFIG_END="# END CODEX OPENSEARCH ACCESS"
readonly -a HOSTS=(
  "os01.home.cz"
  "os02.home.cz"
  "os03.home.cz"
)

ADMIN_USER="$(id -un)"
TARGET_USER="voldzi"
KEY_PATH="${DEFAULT_KEY_PATH}"

usage() {
  cat <<'EOF'
Usage:
  scripts/setup_opensearch_codex_access.sh [options]

Options:
  --admin-user USER   Existing account used to install access on each node.
                      It must be able to log in and run sudo. Defaults to the
                      current local user.
  --target-user USER  Account Codex will use on the OpenSearch nodes.
                      The account must already exist. Defaults to "voldzi".
  --key-path PATH     Dedicated local SSH private-key path.
                      Defaults to ~/.ssh/id_ed25519_opensearch_codex.
  -h, --help          Show this help.

The script:
  1. creates a dedicated Ed25519 key when missing;
  2. installs its public key on os01, os02 and os03;
  3. grants narrowly scoped OpenSearch systemd/journal sudo commands;
  4. installs a resilient OpenSearch systemd drop-in without restarting it;
  5. updates the marked block in ~/.ssh/config;
  6. verifies non-interactive SSH and sudo access.

Passwords are requested interactively by SSH or sudo and are never stored.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

validate_user() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] \
    || fail "Invalid Unix account name: $1"
}

while (($# > 0)); do
  case "$1" in
    --admin-user)
      (($# >= 2)) || fail "--admin-user requires a value"
      ADMIN_USER="$2"
      shift 2
      ;;
    --target-user)
      (($# >= 2)) || fail "--target-user requires a value"
      TARGET_USER="$2"
      shift 2
      ;;
    --key-path)
      (($# >= 2)) || fail "--key-path requires a value"
      KEY_PATH="${2/#\~/${HOME}}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

validate_user "${ADMIN_USER}"
validate_user "${TARGET_USER}"
require_command ssh
require_command scp
require_command ssh-keygen
require_command base64
require_command awk
require_command install
require_command mktemp

mkdir -p "$(dirname "${KEY_PATH}")"
chmod 700 "$(dirname "${KEY_PATH}")"

if [[ ! -f "${KEY_PATH}" ]]; then
  printf 'Creating dedicated SSH key: %s\n' "${KEY_PATH}"
  ssh-keygen \
    -q \
    -t ed25519 \
    -f "${KEY_PATH}" \
    -C "codex-opensearch" \
    -N ""
elif [[ ! -f "${KEY_PATH}.pub" ]]; then
  printf 'Recreating missing public key: %s.pub\n' "${KEY_PATH}"
  ssh-keygen -y -f "${KEY_PATH}" >"${KEY_PATH}.pub"
fi

chmod 600 "${KEY_PATH}"
chmod 644 "${KEY_PATH}.pub"

PUBLIC_KEY="$(tr -d '\r\n' <"${KEY_PATH}.pub")"
[[ "${PUBLIC_KEY}" == ssh-ed25519\ * ]] \
  || fail "The public key is not an Ed25519 SSH key"
PUBLIC_KEY_B64="$(printf '%s' "${PUBLIC_KEY}" | base64 | tr -d '\r\n')"

config_tmp="$(mktemp "${TMPDIR:-/tmp}/codex-opensearch-ssh-config.XXXXXX")"
remote_installer_tmp="$(mktemp "${TMPDIR:-/tmp}/codex-opensearch-remote-installer.XXXXXX")"
cleanup() {
  rm -f "${config_tmp}" "${remote_installer_tmp}"
}
trap cleanup EXIT

cat >"${remote_installer_tmp}" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

target_user="$1"
public_key_b64="$2"

if ! id "${target_user}" >/dev/null 2>&1; then
  printf 'Target account does not exist: %s\n' "${target_user}" >&2
  exit 1
fi

target_home="$(getent passwd "${target_user}" | cut -d: -f6)"
target_group="$(id -gn "${target_user}")"
[[ -n "${target_home}" && "${target_home}" == /* ]] || {
  printf 'Could not resolve a safe home directory for %s\n' "${target_user}" >&2
  exit 1
}

public_key="$(printf '%s' "${public_key_b64}" | base64 -d)"
[[ "${public_key}" == ssh-ed25519\ * ]] || {
  printf 'Invalid public key payload\n' >&2
  exit 1
}

install -d -o "${target_user}" -g "${target_group}" -m 0700 \
  "${target_home}/.ssh"
touch "${target_home}/.ssh/authorized_keys"
chown "${target_user}:${target_group}" "${target_home}/.ssh/authorized_keys"
chmod 0600 "${target_home}/.ssh/authorized_keys"

if ! grep -qxF "${public_key}" "${target_home}/.ssh/authorized_keys"; then
  printf '%s\n' "${public_key}" >>"${target_home}/.ssh/authorized_keys"
fi

systemctl_path="$(command -v systemctl)"
journalctl_path="$(command -v journalctl)"
visudo_path="$(command -v visudo)"
sudoers_path="/etc/sudoers.d/${target_user}-opensearch"
sudoers_tmp="$(mktemp /tmp/opensearch-sudoers.XXXXXX)"
resilience_tmp="$(mktemp /tmp/opensearch-resilience.XXXXXX)"
trap 'rm -f "${sudoers_tmp}" "${resilience_tmp}"' EXIT

cat >"${sudoers_tmp}" <<EOF
${target_user} ALL=(root) NOPASSWD: ${systemctl_path} status opensearch.service, ${systemctl_path} is-active opensearch.service, ${systemctl_path} is-failed opensearch.service, ${systemctl_path} show opensearch.service, ${systemctl_path} start opensearch.service, ${systemctl_path} restart opensearch.service, ${systemctl_path} reset-failed opensearch.service, ${systemctl_path} daemon-reload, ${journalctl_path} -u opensearch.service *
EOF

chmod 0440 "${sudoers_tmp}"
"${visudo_path}" -cf "${sudoers_tmp}"
install -o root -g root -m 0440 "${sudoers_tmp}" "${sudoers_path}"
"${visudo_path}" -cf "${sudoers_path}"

cat >"${resilience_tmp}" <<'EOF'
[Unit]
StartLimitIntervalSec=30min
StartLimitBurst=5

[Service]
TimeoutStartSec=10min
Restart=on-failure
RestartSec=30s
EOF

install -d -o root -g root -m 0755 \
  /etc/systemd/system/opensearch.service.d
install -o root -g root -m 0644 \
  "${resilience_tmp}" \
  /etc/systemd/system/opensearch.service.d/resilience.conf
"${systemctl_path}" daemon-reload

printf 'Access and resilience configured for %s on %s\n' \
  "${target_user}" "$(hostname)"
REMOTE_SCRIPT

chmod 0600 "${remote_installer_tmp}"

for host in "${HOSTS[@]}"; do
  printf '\nConfiguring %s through %s@%s\n' \
    "${TARGET_USER}" "${ADMIN_USER}" "${host}"

  remote_path="/tmp/codex-opensearch-access-${TARGET_USER}-$$.sh"
  scp \
    -q \
    -o StrictHostKeyChecking=accept-new \
    "${remote_installer_tmp}" \
    "${ADMIN_USER}@${host}:${remote_path}"

  remote_shell="sudo bash '${remote_path}' '${TARGET_USER}' '${PUBLIC_KEY_B64}'"
  if [[ "${ADMIN_USER}" == "root" ]]; then
    remote_shell="bash '${remote_path}' '${TARGET_USER}' '${PUBLIC_KEY_B64}'"
  fi
  remote_shell="${remote_shell}; result=\$?; rm -f '${remote_path}'; exit \${result}"

  ssh -tt \
    -o StrictHostKeyChecking=yes \
    "${ADMIN_USER}@${host}" \
    "${remote_shell}"
done

mkdir -p "$(dirname "${SSH_CONFIG}")"
touch "${SSH_CONFIG}"
chmod 600 "${SSH_CONFIG}"

awk -v begin="${CONFIG_BEGIN}" -v end="${CONFIG_END}" '
  $0 == begin { skipping = 1; next }
  $0 == end { skipping = 0; next }
  !skipping { print }
' "${SSH_CONFIG}" >"${config_tmp}"

cat >>"${config_tmp}" <<EOF

${CONFIG_BEGIN}
Host os01.home.cz os02.home.cz os03.home.cz
  User ${TARGET_USER}
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
  PreferredAuthentications publickey
${CONFIG_END}
EOF

install -m 600 "${config_tmp}" "${SSH_CONFIG}"

printf '\nVerifying non-interactive access\n'
for host in "${HOSTS[@]}"; do
  ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=yes \
    "${host}" \
    'hostname'

  if ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=yes \
    "${host}" \
    'sudo -n systemctl is-active opensearch.service'
  then
    printf '%s: OpenSearch is active\n' "${host}"
  else
    printf '%s: access works; OpenSearch is not active\n' "${host}"
  fi

  ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o StrictHostKeyChecking=yes \
    "${host}" \
    'systemctl show opensearch.service --property=TimeoutStartUSec,Restart,RestartUSec,StartLimitIntervalUSec,StartLimitBurst'
done

cat <<EOF

Setup completed.

Private key:
  ${KEY_PATH}

Public key:
  ${KEY_PATH}.pub

No password or private key was copied into the repository or to another host.
EOF
