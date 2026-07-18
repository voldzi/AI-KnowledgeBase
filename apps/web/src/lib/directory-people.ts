import type { DirectoryPersonOption } from "@voldzi/stratos-ui";

import type { DirectoryUser } from "@/lib/types";

export function directoryUsersToPeople(
  users: DirectoryUser[],
): DirectoryPersonOption[] {
  const byId = new Map<string, DirectoryPersonOption>();
  for (const user of users) {
    if (user.enabled === false) {
      continue;
    }
    const name = directoryUserDisplayName(user);
    const title =
      user.username && user.username !== name ? user.username : null;
    byId.set(user.subject_id, {
      id: user.subject_id,
      name,
      email: user.email ?? null,
      title,
      department: user.groups?.[0] ?? null,
      initials: initialsForName(name),
      group: user.groups?.[0] ?? undefined,
    });
  }
  return Array.from(byId.values());
}

export function directoryUserDisplayName(user: DirectoryUser): string {
  return (
    user.display_name ||
    user.username ||
    user.email?.split("@")[0] ||
    user.subject_id
  );
}

function initialsForName(value: string): string {
  const parts = value
    .replace(/[_@.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2);
  return initials.toUpperCase();
}
