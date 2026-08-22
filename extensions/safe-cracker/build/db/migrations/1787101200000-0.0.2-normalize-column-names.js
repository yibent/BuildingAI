'use strict';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const SCHEMA = "safe_cracker";
const COLUMN_RENAMES = {
  safe_game_session: {
    organizationId: "organization_id",
    ownerUserId: "owner_user_id",
    kitSessionKey: "kit_session_key",
    promptTemplate: "prompt_template",
    passwordMode: "password_mode",
    passwordLength: "password_length",
    durationMinutes: "duration_minutes",
    allowDeviceReport: "allow_device_report",
    allowStudentInput: "allow_student_input",
    enableStudentView: "enable_student_view",
    lockStudentEdits: "lock_student_edits",
    startedAt: "started_at",
    endsAt: "ends_at",
    endedAt: "ended_at",
    createdAt: "created_at",
    updatedAt: "updated_at"
  },
  safe_game_participant: {
    sessionId: "session_id",
    agentBindingId: "agent_binding_id",
    agentName: "agent_name",
    studentUserId: "student_user_id",
    studentName: "student_name",
    solvedAt: "solved_at",
    elapsedMs: "elapsed_ms",
    solvedVia: "solved_via",
    readyError: "ready_error",
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
};
async function up(dataSource) {
  for (const [table, columns] of Object.entries(COLUMN_RENAMES)) {
    for (const [oldName, newName] of Object.entries(columns)) {
      const existingColumns = await dataSource.query(`SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = $1
                   AND table_name = $2
                   AND column_name IN ($3, $4)`, [
        SCHEMA,
        table,
        oldName,
        newName
      ]);
      const names = new Set(existingColumns.map(({ column_name }) => column_name));
      if (names.has(oldName) && !names.has(newName)) {
        const identifiers = [
          SCHEMA,
          table,
          oldName,
          newName
        ].map((identifier) => `"${identifier.replaceAll('"', '""')}"`);
        await dataSource.query(`ALTER TABLE ${identifiers[0]}.${identifiers[1]} RENAME COLUMN ${identifiers[2]} TO ${identifiers[3]}`);
      }
    }
  }
}
__name(up, "up");

exports.up = up;
//# sourceMappingURL=1787101200000-0.0.2-normalize-column-names.js.map
//# sourceMappingURL=1787101200000-0.0.2-normalize-column-names.js.map