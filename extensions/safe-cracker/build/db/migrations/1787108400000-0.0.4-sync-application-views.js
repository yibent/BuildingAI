'use strict';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
async function up(dataSource) {
  await dataSource.query(`UPDATE "extension"
         SET "config" = jsonb_set(
             COALESCE("config", '{}'::jsonb),
             '{applicationViews}',
             $2::jsonb,
             true
         )
         WHERE "identifier" = $1`, [
    "safe-cracker",
    JSON.stringify({
      teacher: "",
      student: "student",
      board: "board"
    })
  ]);
}
__name(up, "up");

exports.up = up;
//# sourceMappingURL=1787108400000-0.0.4-sync-application-views.js.map
//# sourceMappingURL=1787108400000-0.0.4-sync-application-views.js.map