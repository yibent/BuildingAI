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
class SafeGameParticipant {
  static {
    __name(this, "SafeGameParticipant");
  }
  id;
  sessionId;
  agentBindingId;
  agentName;
  studentUserId;
  // 可空列必须显式写 type：`string | null` 经 reflect-metadata 反射出来是 Object，
  // TypeORM 推不出列类型，启动时直接 DataTypeNotSupportedError。
  studentName;
  password;
  status;
  attempts;
  solvedAt;
  elapsedMs;
  solvedVia;
  /** 开始时提示词是否成功下发。没下发成功的设备学生怎么问都问不出密码。 */
  ready;
  readyError;
  createdAt;
  updatedAt;
}
_ts_decorate([
  typeorm.PrimaryGeneratedColumn("uuid"),
  _ts_metadata("design:type", String)
], SafeGameParticipant.prototype, "id", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "uuid"
  }),
  _ts_metadata("design:type", String)
], SafeGameParticipant.prototype, "sessionId", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "uuid",
    comment: "\u65B9\u7CD6\u732B\u7ED1\u5B9AID"
  }),
  _ts_metadata("design:type", String)
], SafeGameParticipant.prototype, "agentBindingId", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 100
  }),
  _ts_metadata("design:type", String)
], SafeGameParticipant.prototype, "agentName", void 0);
_ts_decorate([
  typeorm.Index(),
  typeorm.Column({
    type: "uuid",
    nullable: true,
    comment: "\u8BBE\u5907\u5206\u53D1\u7ED9\u7684\u5B66\u751F"
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "studentUserId", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 100,
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "studentName", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 16,
    comment: "\u8FD9\u53F0\u8BBE\u5907\u5B88\u7740\u7684\u5BC6\u7801"
  }),
  _ts_metadata("design:type", String)
], SafeGameParticipant.prototype, "password", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 16,
    default: contract.ParticipantStatus.RACING
  }),
  _ts_metadata("design:type", typeof ParticipantStatusType === "undefined" ? Object : ParticipantStatusType)
], SafeGameParticipant.prototype, "status", void 0);
_ts_decorate([
  typeorm.Column({
    type: "int",
    default: 0
  }),
  _ts_metadata("design:type", Number)
], SafeGameParticipant.prototype, "attempts", void 0);
_ts_decorate([
  typeorm.Column({
    type: "timestamptz",
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "solvedAt", void 0);
_ts_decorate([
  typeorm.Column({
    type: "int",
    nullable: true,
    comment: "\u7834\u89E3\u8017\u65F6\uFF08\u6BEB\u79D2\uFF09"
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "elapsedMs", void 0);
_ts_decorate([
  typeorm.Column({
    type: "varchar",
    length: 16,
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "solvedVia", void 0);
_ts_decorate([
  typeorm.Column({
    type: "boolean",
    default: false
  }),
  _ts_metadata("design:type", Boolean)
], SafeGameParticipant.prototype, "ready", void 0);
_ts_decorate([
  typeorm.Column({
    type: "text",
    nullable: true
  }),
  _ts_metadata("design:type", Object)
], SafeGameParticipant.prototype, "readyError", void 0);
_ts_decorate([
  typeorm.CreateDateColumn(),
  _ts_metadata("design:type", typeof Date === "undefined" ? Object : Date)
], SafeGameParticipant.prototype, "createdAt", void 0);
_ts_decorate([
  typeorm.UpdateDateColumn(),
  _ts_metadata("design:type", typeof Date === "undefined" ? Object : Date)
], SafeGameParticipant.prototype, "updatedAt", void 0);
SafeGameParticipant = _ts_decorate([
  decorators.ExtensionEntity(),
  typeorm.Index([
    "sessionId",
    "agentBindingId"
  ], {
    unique: true
  })
], SafeGameParticipant);

exports.SafeGameParticipant = SafeGameParticipant;
//# sourceMappingURL=safe-game-participant.entity.js.map
//# sourceMappingURL=safe-game-participant.entity.js.map