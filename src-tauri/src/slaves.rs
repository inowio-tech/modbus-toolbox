use crate::db::open_workspace_db;
use crate::models::{
    SlaveCreate, SlaveItem, SlavePatch, SlaveRegisterCount, SlaveRegisterRow, SlaveRegisterRowUpsert,
};

fn is_foreign_key_constraint_error(msg: &str) -> bool {
    msg.to_lowercase().contains("foreign key constraint failed")
}

const SLAVE_COLUMNS: &str =
    "id, name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at";

fn map_slave_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SlaveItem> {
    Ok(SlaveItem {
        id: row.get(0)?,
        name: row.get(1)?,
        unit_id: row.get(2)?,
        poll_interval_ms: row.get(3)?,
        connection_kind: row.get(4)?,
        address_offset: row.get(5).unwrap_or(0),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn fetch_slave(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<SlaveItem> {
    conn.query_row(
        &format!("SELECT {SLAVE_COLUMNS} FROM slaves WHERE id = ?1;"),
        (id,),
        map_slave_row,
    )
}

#[tauri::command]
pub fn list_slaves(app: tauri::AppHandle, name: String) -> Result<Vec<SlaveItem>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SLAVE_COLUMNS} FROM slaves ORDER BY unit_id ASC;"
        ))
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], map_slave_row)
        .map_err(|e| format!("failed to query slaves: {e}"))?;

    let mut out: Vec<SlaveItem> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read slave row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn create_slave(
    app: tauri::AppHandle,
    name: String,
    slave: SlaveCreate,
    now_iso: String,
) -> Result<SlaveItem, String> {
    let conn = open_workspace_db(&app, &name)?;

    let poll_interval_ms = slave.poll_interval_ms.unwrap_or(1000);
    let address_offset = slave.address_offset.unwrap_or(0);

    conn.execute(
        "INSERT INTO slaves (name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        (
            slave.name,
            slave.unit_id,
            poll_interval_ms,
            "serial".to_string(),
            address_offset,
            now_iso.clone(),
            now_iso,
        ),
    )
    .map_err(|e| format!("failed to create slave: {e}"))?;

    let id = conn.last_insert_rowid();

    fetch_slave(&conn, id).map_err(|e| format!("failed to read created slave: {e}"))
}

#[tauri::command]
pub fn update_slave(
    app: tauri::AppHandle,
    name: String,
    id: i64,
    patch: SlavePatch,
    now_iso: String,
) -> Result<SlaveItem, String> {
    let conn = open_workspace_db(&app, &name)?;

    let existing: SlaveItem =
        fetch_slave(&conn, id).map_err(|e| format!("slave not found: {e}"))?;

    let merged_name = patch.name.unwrap_or(Some(existing.name));
    let merged_unit_id = patch.unit_id.unwrap_or(Some(existing.unit_id));
    let merged_poll_interval_ms = patch
        .poll_interval_ms
        .unwrap_or(Some(existing.poll_interval_ms));
    let merged_connection_kind = patch
        .connection_kind
        .unwrap_or(Some(existing.connection_kind));
    let merged_address_offset = patch
        .address_offset
        .unwrap_or(Some(existing.address_offset));

    let merged_name = merged_name.ok_or_else(|| "slave name cannot be null".to_string())?;
    let merged_unit_id = merged_unit_id.ok_or_else(|| "slave unitId cannot be null".to_string())?;
    let merged_poll_interval_ms =
        merged_poll_interval_ms.ok_or_else(|| "slave pollIntervalMs cannot be null".to_string())?;
    let merged_connection_kind = merged_connection_kind
        .ok_or_else(|| "slave connectionKind cannot be null".to_string())?;
    let merged_address_offset = merged_address_offset
        .ok_or_else(|| "slave addressOffset cannot be null".to_string())?;

    conn.execute(
        "UPDATE slaves
         SET name = ?1, unit_id = ?2, poll_interval_ms = ?3, connection_kind = ?4, address_offset = ?5, updated_at = ?6
         WHERE id = ?7;",
        (
            merged_name,
            merged_unit_id,
            merged_poll_interval_ms,
            merged_connection_kind,
            merged_address_offset,
            now_iso,
            id,
        ),
    )
    .map_err(|e| format!("failed to update slave: {e}"))?;

    fetch_slave(&conn, id).map_err(|e| format!("failed to read updated slave: {e}"))
}

#[tauri::command]
pub fn delete_slave(app: tauri::AppHandle, name: String, id: i64) -> Result<(), String> {
    let conn = open_workspace_db(&app, &name)?;
    conn.execute("DELETE FROM slaves WHERE id = ?1;", (id,))
        .map_err(|e| {
            let msg = format!("{e}");
            if is_foreign_key_constraint_error(&msg) {
                "cannot delete slave because it is used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
            } else {
                format!("failed to delete slave: {e}")
            }
        })?;
    Ok(())
}

#[tauri::command]
pub fn list_slave_register_rows(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    function_code: i64,
) -> Result<Vec<SlaveRegisterRow>, String> {
    let conn = open_workspace_db(&app, &name)?;
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    if !matches!(function_code, 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16) {
        return Err("function_code must be one of 1,2,3,4,5,6,15,16".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, slave_id, function_code, address, alias, data_type, \"order\", display_format, write_value, updated_at
             FROM slave_register_rows
             WHERE slave_id = ?1 AND function_code = ?2
             ORDER BY address ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map((slave_id, function_code), |row| {
            Ok(SlaveRegisterRow {
                id: row.get(0)?,
                slave_id: row.get(1)?,
                function_code: row.get(2)?,
                address: row.get(3)?,
                alias: row.get(4)?,
                data_type: row.get(5)?,
                order: row.get(6)?,
                display_format: row.get(7)?,
                write_value: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("failed to query register rows: {e}"))?;

    let mut out: Vec<SlaveRegisterRow> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read register row: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn save_slave_register_rows(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    function_code: i64,
    rows: Vec<SlaveRegisterRowUpsert>,
    now_iso: String,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    if !matches!(function_code, 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16) {
        return Err("function_code must be one of 1,2,3,4,5,6,15,16".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    let mut addresses: Vec<i64> = Vec::with_capacity(rows.len());
    {
        let mut upsert = tx
            .prepare(
                "INSERT INTO slave_register_rows (
                    slave_id, function_code, address,
                    alias, data_type, \"order\", display_format,
                    write_value,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(slave_id, function_code, address) DO UPDATE SET
                    alias=excluded.alias,
                    data_type=excluded.data_type,
                    \"order\"=excluded.\"order\",
                    display_format=excluded.display_format,
                    write_value=excluded.write_value,
                    updated_at=excluded.updated_at;",
            )
            .map_err(|e| format!("failed to prepare upsert: {e}"))?;

        for r in &rows {
            if r.address < 0 {
                return Err("address must be >= 0".to_string());
            }
            let dt = r.data_type.trim();
            if dt.is_empty() {
                return Err("data_type is required".to_string());
            }
            let order = r.order.trim();
            let order_value = if order.is_empty() { "ABCD" } else { order };
            let fmt = r.display_format.trim();
            if fmt.is_empty() {
                return Err("display_format is required".to_string());
            }

            upsert
                .execute((
                    slave_id,
                    function_code,
                    r.address,
                    r.alias.trim(),
                    dt,
                    order_value,
                    fmt,
                    r.write_value,
                    now_iso.as_str(),
                ))
                .map_err(|e| format!("failed to upsert register row: {e}"))?;
            addresses.push(r.address);
        }
    }

    addresses.sort_unstable();
    addresses.dedup();

    // Delete rows that were removed by the user (this is the only part that can be blocked
    // by analyzer foreign key constraints).
    if addresses.is_empty() {
        tx.execute(
            "DELETE FROM slave_register_rows WHERE slave_id = ?1 AND function_code = ?2;",
            (slave_id, function_code),
        )
        .map_err(|e| {
            let msg = format!("{e}");
            if is_foreign_key_constraint_error(&msg) {
                "cannot delete register rows because some are used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
            } else {
                format!("failed to delete removed register rows: {e}")
            }
        })?;
    } else {
        let mut sql =
            "DELETE FROM slave_register_rows WHERE slave_id = ?1 AND function_code = ?2 AND address NOT IN ("
                .to_string();
        for i in 0..addresses.len() {
            if i > 0 {
                sql.push(',');
            }
            sql.push_str(&format!("?{}", i + 3));
        }
        sql.push_str(");");

        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(2 + addresses.len());
        params.push(rusqlite::types::Value::Integer(slave_id));
        params.push(rusqlite::types::Value::Integer(function_code));
        for a in addresses {
            params.push(rusqlite::types::Value::Integer(a));
        }

        tx.execute(&sql, rusqlite::params_from_iter(params))
            .map_err(|e| {
                let msg = format!("{e}");
                if is_foreign_key_constraint_error(&msg) {
                    "cannot delete register rows because some are used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
                } else {
                    format!("failed to delete removed register rows: {e}")
                }
            })?;
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn count_slave_register_rows(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<SlaveRegisterCount>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT slave_id, function_code, COUNT(*) AS cnt
             FROM slave_register_rows
             GROUP BY slave_id, function_code
             ORDER BY slave_id, function_code;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SlaveRegisterCount {
                slave_id: row.get(0)?,
                function_code: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| format!("failed to query register counts: {e}"))?;

    let mut out: Vec<SlaveRegisterCount> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read register count row: {e}"))?);
    }
    Ok(out)
}

pub(crate) fn clone_slave_in_conn(
    conn: &mut rusqlite::Connection,
    source_id: i64,
    new_name: &str,
    new_unit_id: i64,
    now_iso: &str,
) -> Result<SlaveItem, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("slave name is required".to_string());
    }
    if new_unit_id <= 0 {
        return Err("slave unitId must be a positive number".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    let source = fetch_slave(&tx, source_id).map_err(|e| format!("slave not found: {e}"))?;

    tx.execute(
        "INSERT INTO slaves (name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        (
            trimmed,
            new_unit_id,
            source.poll_interval_ms,
            source.connection_kind.as_str(),
            source.address_offset,
            now_iso,
            now_iso,
        ),
    )
    .map_err(|e| format!("failed to create slave: {e}"))?;

    let new_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO slave_register_rows
            (slave_id, function_code, address, alias, data_type, \"order\", display_format, write_value, updated_at)
         SELECT ?1, function_code, address, alias, data_type, \"order\", display_format, write_value, ?2
         FROM slave_register_rows
         WHERE slave_id = ?3;",
        (new_id, now_iso, source_id),
    )
    .map_err(|e| format!("failed to copy register rows: {e}"))?;

    let created =
        fetch_slave(&tx, new_id).map_err(|e| format!("failed to read created slave: {e}"))?;

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(created)
}

#[tauri::command]
pub fn clone_slave(
    app: tauri::AppHandle,
    name: String,
    id: i64,
    new_name: String,
    new_unit_id: i64,
    now_iso: String,
) -> Result<SlaveItem, String> {
    let mut conn = open_workspace_db(&app, &name)?;
    clone_slave_in_conn(&mut conn, id, &new_name, new_unit_id, &now_iso)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ensure_workspace_db;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    const NOW: &str = "2026-08-04T10:00:00Z";

    fn temp_db() -> (PathBuf, rusqlite::Connection) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("slaves_clone_test_{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp dir");
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = rusqlite::Connection::open(dir.join("workspace.db")).expect("open db");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragma");
        (dir, conn)
    }

    fn cleanup(dir: PathBuf, conn: rusqlite::Connection) {
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn seed_slave(
        conn: &rusqlite::Connection,
        name: &str,
        unit_id: i64,
        poll_interval_ms: i64,
        connection_kind: &str,
        address_offset: i64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO slaves (name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
            (name, unit_id, poll_interval_ms, connection_kind, address_offset),
        )
        .expect("insert slave");
        conn.last_insert_rowid()
    }

    fn seed_row(conn: &rusqlite::Connection, slave_id: i64, function_code: i64, address: i64, alias: &str) {
        conn.execute(
            "INSERT INTO slave_register_rows
                (slave_id, function_code, address, alias, data_type, \"order\", display_format, write_value, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'u16', 'BADC', 'hex', 7, '2026-01-01T00:00:00Z');",
            (slave_id, function_code, address, alias),
        )
        .expect("insert register row");
    }

    fn count_rows(conn: &rusqlite::Connection, slave_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM slave_register_rows WHERE slave_id = ?1;",
            (slave_id,),
            |r| r.get(0),
        )
        .expect("count rows")
    }

    fn count_slaves(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM slaves;", (), |r| r.get(0))
            .expect("count slaves")
    }

    #[test]
    fn clone_copies_register_rows_across_function_codes() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "SHT20", 3, 1000, "serial", 0);
        seed_row(&conn, source, 3, 0x0101, "temperature");
        seed_row(&conn, source, 3, 0x0102, "humidity");
        seed_row(&conn, source, 4, 0, "status");
        seed_row(&conn, source, 1, 5, "relay");

        let cloned = clone_slave_in_conn(&mut conn, source, "SHT20 (copy)", 4, NOW).expect("clone");

        assert_eq!(count_rows(&conn, cloned.id), 4);
        let (fc, address, alias, data_type, order, display_format, write_value, updated_at): (
            i64,
            i64,
            String,
            String,
            String,
            String,
            Option<i64>,
            String,
        ) = conn
            .query_row(
                "SELECT function_code, address, alias, data_type, \"order\", display_format, write_value, updated_at
                 FROM slave_register_rows WHERE slave_id = ?1 AND function_code = 3 AND address = 258;",
                (cloned.id,),
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .expect("cloned row");
        assert_eq!(fc, 3);
        assert_eq!(address, 0x0102);
        assert_eq!(alias, "humidity");
        assert_eq!(data_type, "u16");
        assert_eq!(order, "BADC");
        assert_eq!(display_format, "hex");
        assert_eq!(write_value, Some(7));
        assert_eq!(updated_at, NOW, "copied row must carry the clone timestamp, not the source's");
        cleanup(dir, conn);
    }

    #[test]
    fn clone_copies_slave_settings_but_takes_new_identity() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "Meter", 9, 2500, "tcp", 40001);

        let cloned = clone_slave_in_conn(&mut conn, source, "  Meter (copy)  ", 10, NOW).expect("clone");

        assert_ne!(cloned.id, source);
        assert_eq!(cloned.name, "Meter (copy)", "name is trimmed");
        assert_eq!(cloned.unit_id, 10);
        assert_eq!(cloned.poll_interval_ms, 2500);
        assert_eq!(cloned.connection_kind, "tcp");
        assert_eq!(cloned.address_offset, 40001);
        assert_eq!(cloned.created_at, NOW);
        assert_eq!(cloned.updated_at, NOW);
        cleanup(dir, conn);
    }

    #[test]
    fn clone_leaves_the_source_untouched() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "Pump", 1, 1000, "serial", 0);
        seed_row(&conn, source, 3, 10, "speed");

        clone_slave_in_conn(&mut conn, source, "Pump (copy)", 2, NOW).expect("clone");

        let original = fetch_slave(&conn, source).expect("source still there");
        assert_eq!(original.name, "Pump");
        assert_eq!(original.unit_id, 1);
        assert_eq!(original.updated_at, "2026-01-01T00:00:00Z");
        assert_eq!(count_rows(&conn, source), 1);
        cleanup(dir, conn);
    }

    #[test]
    fn clone_of_unknown_source_creates_nothing() {
        let (dir, mut conn) = temp_db();
        seed_slave(&conn, "Pump", 1, 1000, "serial", 0);

        let err = clone_slave_in_conn(&mut conn, 4242, "Ghost", 2, NOW).expect_err("must fail");

        assert!(err.contains("slave not found"), "unexpected error: {err}");
        assert_eq!(count_slaves(&conn), 1, "no partial slave left behind");
        cleanup(dir, conn);
    }

    #[test]
    fn clone_rejects_blank_name_and_non_positive_unit_id() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "Pump", 1, 1000, "serial", 0);

        let blank = clone_slave_in_conn(&mut conn, source, "   ", 2, NOW).expect_err("blank name");
        assert!(blank.contains("name is required"), "unexpected error: {blank}");

        let bad_unit = clone_slave_in_conn(&mut conn, source, "Pump (copy)", 0, NOW)
            .expect_err("bad unit id");
        assert!(bad_unit.contains("positive"), "unexpected error: {bad_unit}");

        let negative_unit = clone_slave_in_conn(&mut conn, source, "Pump (copy)", -1, NOW)
            .expect_err("negative unit id");
        assert!(
            negative_unit.contains("positive"),
            "unexpected error: {negative_unit}"
        );

        assert_eq!(count_slaves(&conn), 1);
        cleanup(dir, conn);
    }

    #[test]
    fn clone_rolls_back_the_new_slave_when_copying_rows_fails() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "Pump", 1, 1000, "serial", 0);
        seed_row(&conn, source, 3, 10, "speed");
        conn.execute_batch(
            "CREATE TEMP TRIGGER block_copy BEFORE INSERT ON slave_register_rows
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .expect("temp trigger");

        let err = clone_slave_in_conn(&mut conn, source, "Pump (copy)", 2, NOW)
            .expect_err("row copy must fail");

        assert!(err.contains("failed to copy register rows"), "unexpected error: {err}");
        assert_eq!(count_slaves(&conn), 1, "the slave insert must roll back");
        cleanup(dir, conn);
    }

    #[test]
    fn clone_of_a_slave_without_registers_succeeds() {
        let (dir, mut conn) = temp_db();
        let source = seed_slave(&conn, "Empty", 5, 1000, "serial", 0);

        let cloned = clone_slave_in_conn(&mut conn, source, "Empty (copy)", 6, NOW).expect("clone");

        assert_eq!(count_rows(&conn, cloned.id), 0);
        assert_eq!(count_slaves(&conn), 2);
        cleanup(dir, conn);
    }
}
