from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def test_revision_ids_fit_default_alembic_version_column() -> None:
    config = Config(str(SERVICE_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
    revisions = list(ScriptDirectory.from_config(config).walk_revisions())

    oversized = [revision.revision for revision in revisions if len(revision.revision) > 32]

    assert not oversized, (
        "Alembic stores revision IDs in alembic_version.version_num VARCHAR(32); "
        f"oversized IDs: {oversized}"
    )
