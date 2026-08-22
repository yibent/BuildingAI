'use strict';

var decorators = require('@buildingai/core/decorators');
var typeorm = require('typeorm');
var contract = require('../../shared/contract');

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
function _ts_decorate(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
__name(_ts_decorate, "_ts_decorate");
function _ts_metadata(k, v) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
__name(_ts_metadata, "_ts_metadata");
class SafeGameSession {
  static {
    __name(this, "SafeGameSession");
  }
  id;
  organizationId;
  ownerUserId;
  /** 传给 ClassroomKit 的会话标识，结束时用它归还设备。 */
  kitSessionKey;
  title;
  status;
  promptTemplate;
  passwordMode;
  passwordLength;
  durationMinutes;
  allowDeviceReport;
  allowStudentInput;
  enableStudentView;
  lockStudentEdits;
  startedAt;
  endsAt;
  endedAt;
  createdAt;
  updatedAt;
}
_ts_decorate([
  typeorm.PrimaryGeneratedColumn("uuid"),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "id", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "uuid",
    comment: "\u6240\u5C5E\u73ED\u7EA7"
  }),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "organizationId", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "uuid",
    comment: "\u53D1\u8D77\u6E38\u620F\u7684\u8001\u5E08"
  }),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "ownerUserId", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 120,
    comment: "ClassroomKit \u4F1A\u8BDD\u6807\u8BC6"
  }),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "kitSessionKey", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 120,
    default: "\u7834\u89E3\u4FDD\u9669\u7BB1"
  }),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "title", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "varchar",
    length: 16,
    default: contract.GameStatus.DRAFT
  }),
  _ts_metadata("design:type", typeof GameStatusType === "undefined" ? Object : GameStatusType)
], SafeGameSession.prototype, "status", void 0);
_ts_decorate([
  typeorm.Column({
    type: "text",
    comment: "\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u542B {{password}} \u5360\u4F4D"
  }),
  _ts_metadata("design:type", String)
], SafeGameSession.prototype, "promptTemplate", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 16,
    default: contract.PasswordMode.PER_STUDENT
  }),
  _ts_metadata("design:type", typeof PasswordModeType === "undefined" ? Object : PasswordModeType)
], SafeGameSession.prototype, "passwordMode", void 0);
_ts_decorate([
  typeorm.Column({
    type: "int",
    default: 4
  }),
  _ts_metadata("design:type", Number)
], SafeGameSession.prototype, "passwordLength", void 0);
_ts_decorate([
  typeorm.Column({
    type: "int",
    default: 15
  }),
  _ts_metadata("design:type", Number)
], SafeGameSession.prototype, "durationMinutes", void 0);
_ts_decorate([
  typeorm.Column({
    type: "boolean",
    default: true,
    comment: "\u5141\u8BB8\u65B9\u7CD6\u732B\u901A\u8FC7 MCP \u4E3B\u52A8\u4E0A\u62A5"
  }),
  _ts_metadata("design:type", Boolean)
], SafeGameSession.prototype, "allowDeviceReport", void 0);
_ts_decorate([
  typeorm.Column({
    type: "boolean",
    default: true,
    comment: "\u5141\u8BB8\u5B66\u751F\u5728\u5B66\u751F\u7AEF\u8F93\u5165\u5BC6\u7801"
  }),
  _ts_metadata("design:type", Boolean)
], SafeGameSession.prototype, "allowStudentInput", void 0);
_ts_decorate([
  typeorm.Column({
    type: "boolean",
    default: true,
    comment: "\u662F\u5426\u542F\u7528\u5B66\u751F\u7AEF\u9875\u9762"
  }),
  _ts_metadata("design:type", Boolean)
], SafeGameSession.prototype, "enableStudentView", void 0);
_ts_decorate([
  typeorm.Column({
    type: "boolean",
    default: true,
    comment: "\u6E38\u620F\u671F\u95F4\u7981\u6B62\u5B66\u751F\u6539\u81EA\u5DF1\u7684\u65B9\u7CD6\u732B"
  }),
  _ts_metadata("design:type", Boolean)
], SafeGameSession.prototype, "lockStudentEdits", void 0);
_ts_decorate([
  typeorm.Column({
    type: "timestamptz",
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameSession.prototype, "startedAt", void 0);
_ts_decorate([
  typeorm.Column({
    type: "timestamptz",
    nullable: true,
    comment: "\u5230\u70B9\u81EA\u52A8\u7ED3\u675F"
  }),
  _ts_metadata("design:type", Object)
], SafeGameSession.prototype, "endsAt", void 0);
_ts_decorate([
  typeorm.Column({
    type: "timestamptz",
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameSession.prototype, "endedAt", void 0);
_ts_decorate([
  typeorm.CreateDateColumn(),
  _ts_metadata("design:type", typeof Date === "undefined" ? Object : Date)
], SafeGameSession.prototype, "createdAt", void 0);
_ts_decorate([
  typeorm.UpdateDateColumn(),
  _ts_metadata("design:type", typeof Date === "undefined" ? Object : Date)
], SafeGameSession.prototype, "updatedAt", void 0);
SafeGameSession = _ts_decorate([
  decorators.ExtensionEntity()
], SafeGameSession);

exports.SafeGameSession = SafeGameSession;
//# sourceMappingURL=safe-game-session.entity.js.map
//# sourceMappingURL=safe-game-session.entity.js.map