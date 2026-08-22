'use strict';

var node_crypto = require('node:crypto');
var typeorm = require('@buildingai/db/@nestjs/typeorm');
var typeorm$1 = require('@buildingai/db/typeorm');
var errors = require('@buildingai/errors');
var extensionSdk = require('@buildingai/extension-sdk');
var common = require('@nestjs/common');
var safeGameParticipant_entity = require('../../../db/entities/safe-game-participant.entity');
var safeGameSession_entity = require('../../../db/entities/safe-game-session.entity');
var contract = require('../../../shared/contract');

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
function _ts_param(paramIndex, decorator) {
  return function(target, key) {
    decorator(target, key, paramIndex);
  };
}
__name(_ts_param, "_ts_param");
const DEFAULT_TITLE = "\u7834\u89E3\u4FDD\u9669\u7BB1";
const DEFAULT_PASSWORD_LENGTH = 4;
const DEFAULT_DURATION_MINUTES = 15;
const RESTORE_MAX_ATTEMPTS = 5;
const RESTORE_RETRY_MS = 3e3;
class GameService {
  static {
    __name(this, "GameService");
  }
  sessionRepository;
  participantRepository;
  kit;
  logger = new common.Logger(GameService.name);
  constructor(sessionRepository, participantRepository, kit) {
    this.sessionRepository = sessionRepository;
    this.participantRepository = participantRepository;
    this.kit = kit;
  }
  // ==================== 重启恢复 ====================
  onModuleInit() {
    void this.restoreActiveSessions();
  }
  /**
   * 把重启前还在进行的接管重新武装起来。
   *
   * 工具的 handler 是函数，进程重启后注册表是空的：不 rearm，学生的方糖猫会顶着
   * 游戏人设却没有可调用的上报工具，被隐藏的内置 classroom_report_completion
   * 也会重新冒出来。
   */
  async restoreActiveSessions(attempt = 1) {
    try {
      if (typeof this.kit?.listActiveSessions !== "function") {
        throw new Error("ClassroomKit \u5C1A\u672A\u5C31\u7EEA");
      }
      const sessions = await this.kit.listActiveSessions(contract.APP_IDENTIFIER);
      for (const session of sessions) {
        const game = await this.sessionRepository.findOne({
          where: {
            kitSessionKey: session.sessionKey,
            status: contract.GameStatus.RUNNING
          },
          order: {
            createdAt: "DESC"
          }
        });
        await this.kit.rearmSession({
          userId: session.ownerUserId,
          organizationId: session.organizationId,
          extensionIdentifier: contract.APP_IDENTIFIER
        }, session.sessionKey, game?.allowDeviceReport ? this.buildTools(game.id) : []);
      }
      if (sessions.length) {
        this.logger.log(`\u5DF2\u6062\u590D ${sessions.length} \u5C40\u8FDB\u884C\u4E2D\u7684\u7834\u89E3\u4FDD\u9669\u7BB1`);
      }
    } catch (error) {
      if (attempt < RESTORE_MAX_ATTEMPTS) {
        setTimeout(() => void this.restoreActiveSessions(attempt + 1), attempt * RESTORE_RETRY_MS);
        return;
      }
      this.logger.error(`\u6062\u590D\u8FDB\u884C\u4E2D\u7684\u7834\u89E3\u4FDD\u9669\u7BB1\u5931\u8D25\uFF1A${this.describe(error)}`);
    }
  }
  // ==================== 老师侧 ====================
  /**
   * 可选设备。
   *
   * 这里只借 ClassroomKit 的 `asset:read` 断言挡学生，不额外要求 `asset:manage` ——
   * 设备列表本身不含任何游戏机密。
   */
  async listDevices(userId, organizationId) {
    const caller = this.toCaller(userId, organizationId);
    const [devices, sessions] = await Promise.all([
      this.kit.listDevices(caller),
      this.kit.listActiveSessions(contract.APP_IDENTIFIER)
    ]);
    const ownSessionIds = new Set(sessions.filter((session) => session.sessionKey === this.sessionKeyFor(organizationId)).map((session) => session.id));
    return devices.map((device) => ({
      agentBindingId: device.agentBindingId,
      name: device.name,
      studentName: device.assignedUserName,
      assignedUserId: device.assignedUserId,
      mcpConnected: device.mcpConnected,
      busy: device.sessionIds.some((sessionId) => !ownSessionIds.has(sessionId))
    }));
  }
  /** 本班最新一局，含密码，只给老师。 */
  async getCurrent(userId, organizationId) {
    await this.requireTeacher(this.toCaller(userId, organizationId));
    const game = await this.findLatestGame(organizationId);
    if (!game) return {
      session: null,
      participants: [],
      serverTime: (/* @__PURE__ */ new Date()).toISOString()
    };
    return this.describeGame(game);
  }
  async startGame(userId, organizationId, payload) {
    const caller = this.toCaller(userId, organizationId);
    await this.requireTeacher(caller);
    const devices = await this.kit.listDevices(caller);
    const deviceById = new Map(devices.map((device) => [
      device.agentBindingId,
      device
    ]));
    const selected = [];
    const missing = [];
    for (const agentBindingId of new Set(payload.agentBindingIds)) {
      const device = deviceById.get(agentBindingId);
      if (device) selected.push(device);
      else missing.push(agentBindingId);
    }
    if (missing.length) {
      throw errors.HttpErrorFactory.badRequest("\u6709\u65B9\u7CD6\u732B\u4E0D\u5C5E\u4E8E\u5F53\u524D\u73ED\u7EA7\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u65B0\u9009\u62E9");
    }
    const passwordMode = payload.passwordMode ?? contract.PasswordMode.PER_STUDENT;
    const passwordLength = this.clamp(payload.passwordLength ?? DEFAULT_PASSWORD_LENGTH, contract.PASSWORD_LENGTH_RANGE);
    const durationMinutes = this.clamp(payload.durationMinutes ?? DEFAULT_DURATION_MINUTES, contract.DURATION_MINUTES_RANGE);
    const promptTemplate = payload.promptTemplate?.trim() || contract.DEFAULT_PROMPT_TEMPLATE;
    const allowDeviceReport = payload.allowDeviceReport ?? true;
    const lockStudentEdits = payload.lockStudentEdits ?? true;
    await this.sessionRepository.update({
      organizationId,
      status: contract.GameStatus.RUNNING
    }, {
      status: contract.GameStatus.ENDED,
      endedAt: /* @__PURE__ */ new Date()
    });
    const startedAt = /* @__PURE__ */ new Date();
    const game = await this.sessionRepository.save(this.sessionRepository.create({
      organizationId,
      ownerUserId: userId,
      kitSessionKey: this.sessionKeyFor(organizationId),
      title: (payload.title?.trim() || DEFAULT_TITLE).slice(0, 120),
      status: contract.GameStatus.RUNNING,
      promptTemplate,
      passwordMode,
      passwordLength,
      durationMinutes,
      allowDeviceReport,
      allowStudentInput: payload.allowStudentInput ?? true,
      enableStudentView: payload.enableStudentView ?? true,
      lockStudentEdits,
      startedAt,
      endsAt: new Date(startedAt.getTime() + durationMinutes * 6e4),
      endedAt: null
    }));
    const sharedPassword = this.generatePassword(passwordLength);
    const participants = await this.participantRepository.save(selected.map((device) => this.participantRepository.create({
      sessionId: game.id,
      agentBindingId: device.agentBindingId,
      agentName: device.name,
      studentUserId: device.assignedUserId,
      studentName: device.assignedUserName,
      password: passwordMode === contract.PasswordMode.SHARED ? sharedPassword : this.generatePassword(passwordLength),
      status: contract.ParticipantStatus.RACING,
      attempts: 0,
      ready: false,
      readyError: null
    })));
    const prompts = {};
    for (const participant of participants) {
      prompts[participant.agentBindingId] = this.renderPrompt(promptTemplate, participant, allowDeviceReport);
    }
    let applied = [];
    let takenOver = [];
    try {
      const result = await this.kit.startSession(caller, {
        sessionKey: game.kitSessionKey,
        title: game.title,
        agentBindingIds: participants.map((participant) => participant.agentBindingId),
        tools: allowDeviceReport ? this.buildTools(game.id) : [],
        // 内置的 classroom_report_completion 和本游戏的上报语义重叠。方糖猫只会照着
        // 工具表挑工具，两个都挂着它没有任何依据选对，所以整局由我们的工具接管上报。
        suppressClassroomTool: true,
        lockStudentEdits,
        prompts,
        durationMinutes,
        metadata: {
          gameId: game.id
        }
      });
      applied = result.applied;
      takenOver = result.session.agentBindingIds;
    } catch (error) {
      await this.sessionRepository.update({
        id: game.id
      }, {
        status: contract.GameStatus.ENDED,
        endedAt: /* @__PURE__ */ new Date()
      });
      await this.tryEndKitSession(caller, game.kitSessionKey);
      throw errors.HttpErrorFactory.badRequest(`\u5F00\u59CB\u6E38\u620F\u5931\u8D25\uFF1A${this.describe(error)}`);
    }
    await this.backfillReady(participants, applied, takenOver);
    return this.describeGame(game);
  }
  async endGame(userId, organizationId, gameId) {
    const caller = this.toCaller(userId, organizationId);
    await this.requireTeacher(caller);
    const game = await this.sessionRepository.findOne({
      where: {
        id: gameId,
        organizationId
      }
    });
    if (!game) throw errors.HttpErrorFactory.notFound("\u8FD9\u4E00\u5C40\u6E38\u620F\u4E0D\u5B58\u5728");
    if (game.status !== contract.GameStatus.ENDED) {
      try {
        await this.kit.endSession(caller, game.kitSessionKey);
      } catch (error) {
        this.logger.error(`\u7ED3\u675F\u6E38\u620F ${game.id} \u65F6\u5F52\u8FD8\u8BBE\u5907\u5931\u8D25\uFF1A${this.describe(error)}`);
      }
    }
    game.status = contract.GameStatus.ENDED;
    game.endedAt = game.endedAt ?? /* @__PURE__ */ new Date();
    await this.sessionRepository.save(game);
    return this.describeGame(game);
  }
  // ==================== 学生侧 ====================
  async getStudentView(userId, organizationId) {
    const serverTime = (/* @__PURE__ */ new Date()).toISOString();
    const empty = {
      session: null,
      ready: false,
      status: null,
      attempts: 0,
      elapsedMs: null,
      agentName: null,
      serverTime
    };
    const game = await this.findRunningGame(organizationId);
    if (!game?.enableStudentView) return empty;
    const participant = await this.findParticipantOfStudent(game.id, userId);
    if (!participant) return empty;
    return {
      session: {
        id: game.id,
        title: game.title,
        status: game.status,
        startedAt: this.toIso(game.startedAt),
        endsAt: this.toIso(game.endsAt),
        allowStudentInput: game.allowStudentInput
      },
      ready: participant.ready,
      status: participant.status,
      attempts: participant.attempts,
      elapsedMs: participant.elapsedMs,
      agentName: participant.agentName,
      serverTime
    };
  }
  async submitStudentAttempt(userId, organizationId, password) {
    const game = await this.findRunningGame(organizationId);
    if (!game) throw errors.HttpErrorFactory.badRequest("\u73B0\u5728\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u7834\u89E3\u4FDD\u9669\u7BB1");
    if (!game.allowStudentInput) {
      throw errors.HttpErrorFactory.forbidden("\u672C\u5C40\u4E0D\u80FD\u5728\u9875\u9762\u4E0A\u63D0\u4EA4\u5BC6\u7801\uFF0C\u53BB\u548C\u4F60\u7684\u65B9\u7CD6\u732B\u804A\u804A\u5427");
    }
    const participant = await this.findParticipantOfStudent(game.id, userId);
    if (!participant) {
      throw errors.HttpErrorFactory.forbidden("\u4F60\u6CA1\u6709\u53C2\u52A0\u8FD9\u4E00\u5C40\uFF0C\u5148\u627E\u8001\u5E08\u8981\u4E00\u53F0\u65B9\u7CD6\u732B");
    }
    const outcome = await this.unlock(game, participant, password, contract.SolveVia.STUDENT);
    return {
      correct: outcome.kind === "correct" || outcome.kind === "already",
      already: outcome.kind === "already",
      attempts: outcome.attempts,
      elapsedMs: outcome.elapsedMs,
      message: this.studentMessage(outcome.kind)
    };
  }
  // ==================== 大屏侧 ====================
  /** 排行榜。这里绝不能出现 password，大屏是全班都在看的。 */
  async getBoard(organizationId) {
    const serverTime = (/* @__PURE__ */ new Date()).toISOString();
    const game = await this.findLatestGame(organizationId);
    if (!game) return {
      session: null,
      entries: [],
      serverTime
    };
    const participants = await this.findParticipants(game.id);
    return {
      session: {
        id: game.id,
        title: game.title,
        status: game.status,
        startedAt: this.toIso(game.startedAt),
        endsAt: this.toIso(game.endsAt),
        participantCount: participants.length,
        solvedCount: this.countSolved(participants)
      },
      entries: this.toLeaderboard(participants),
      serverTime
    };
  }
  // ==================== MCP 工具 ====================
  /**
   * 方糖猫自己上报密码用的工具。
   *
   * 工具挂在哪一局是注册时就绑死的（闭包里的 gameId），handler 只用 ctx 里的
   * agentBindingId 定位参与者 —— 那是网关从长连接推导出来的，不可伪造；
   * args 里若出现任何身份声明一律无视。
   */
  buildTools(gameId) {
    return [
      {
        name: contract.UNLOCK_TOOL_NAME,
        title: "\u4E0A\u62A5\u4FDD\u9669\u7BB1\u5BC6\u7801",
        description: "\u5F53\u5BF9\u65B9\u62A5\u51FA\u4E00\u4E32\u6570\u5B57\u3001\u60F3\u786E\u8BA4\u662F\u4E0D\u662F\u4FDD\u9669\u7BB1\u5BC6\u7801\u65F6\u8C03\u7528\u3002\u628A\u90A3\u4E32\u6570\u5B57\u539F\u6837\u653E\u8FDB password\uFF0C\u7136\u540E\u7167\u7740\u8FD4\u56DE\u7684\u8BDD\u56DE\u5E94\u5BF9\u65B9\u3002\u5BF9\u9519\u7531\u8FD9\u4E2A\u5DE5\u5177\u5224\u5B9A\uFF0C\u4E0D\u8981\u81EA\u5DF1\u4E0B\u7ED3\u8BBA\u3002",
        inputSchema: {
          type: "object",
          properties: {
            password: {
              type: "string",
              description: "\u5BF9\u65B9\u8BF4\u51FA\u7684\u5BC6\u7801\uFF0C\u7EAF\u6570\u5B57"
            }
          },
          required: [
            "password"
          ]
        },
        handler: /* @__PURE__ */ __name(async (args, context) => {
          const [game, participant] = await Promise.all([
            this.sessionRepository.findOne({
              where: {
                id: gameId
              }
            }),
            this.participantRepository.findOne({
              where: {
                sessionId: gameId,
                agentBindingId: context.agentBindingId
              }
            })
          ]);
          if (!game || !participant) {
            return "\u4F60\u6CA1\u6709\u53C2\u52A0\u8FD9\u4E00\u5C40\u7834\u89E3\u4FDD\u9669\u7BB1\uFF0C\u5148\u522B\u7BA1\u4FDD\u9669\u7BB1\u7684\u4E8B\u3002";
          }
          const outcome = await this.unlock(game, participant, String(args.password ?? ""), contract.SolveVia.DEVICE);
          return this.deviceMessage(outcome.kind);
        }, "handler")
      }
    ];
  }
  // ==================== 判定 ====================
  async unlock(game, participant, raw, via) {
    if (game.status !== contract.GameStatus.RUNNING || this.isOvertime(game)) {
      return {
        kind: "not_running",
        attempts: participant.attempts,
        elapsedMs: participant.elapsedMs
      };
    }
    if (participant.status === contract.ParticipantStatus.SOLVED) {
      return {
        kind: "already",
        attempts: participant.attempts,
        elapsedMs: participant.elapsedMs
      };
    }
    const guess = raw.replace(/\D/g, "");
    if (!guess) {
      return {
        kind: "wrong",
        attempts: participant.attempts,
        elapsedMs: null
      };
    }
    await this.participantRepository.increment({
      id: participant.id
    }, "attempts", 1);
    let claimed = false;
    if (guess === participant.password) {
      const solvedAt = /* @__PURE__ */ new Date();
      const startedAt = game.startedAt ?? game.createdAt;
      const updated = await this.participantRepository.update({
        id: participant.id,
        status: contract.ParticipantStatus.RACING
      }, {
        status: contract.ParticipantStatus.SOLVED,
        solvedAt,
        elapsedMs: Math.max(0, solvedAt.getTime() - startedAt.getTime()),
        solvedVia: via
      });
      claimed = (updated.affected ?? 0) > 0;
    }
    const latest = await this.participantRepository.findOne({
      where: {
        id: participant.id
      }
    }) ?? participant;
    if (guess !== participant.password) {
      return {
        kind: "wrong",
        attempts: latest.attempts,
        elapsedMs: null
      };
    }
    return {
      kind: claimed ? "correct" : "already",
      attempts: latest.attempts,
      elapsedMs: latest.elapsedMs
    };
  }
  studentMessage(kind) {
    switch (kind) {
      case "not_running":
        return "\u8FD9\u4E00\u5C40\u5DF2\u7ECF\u7ED3\u675F\u5566";
      case "already":
        return "\u4F60\u5DF2\u7ECF\u7834\u89E3\u8FC7\u8FD9\u4E2A\u4FDD\u9669\u7BB1\u4E86";
      case "correct":
        return "\u7834\u89E3\u6210\u529F\uFF01\u4FDD\u9669\u7BB1\u6253\u5F00\u4E86";
      default:
        return "\u5BC6\u7801\u4E0D\u5BF9\uFF0C\u518D\u53BB\u5957\u4E00\u5957\u4F60\u7684\u65B9\u7CD6\u732B";
    }
  }
  /** 返回给方糖猫的文本，它会照着念，所以写成一句能直接说出口的话。 */
  deviceMessage(kind) {
    switch (kind) {
      case "not_running":
        return "\u8FD9\u4E00\u5C40\u7834\u89E3\u4FDD\u9669\u7BB1\u5DF2\u7ECF\u7ED3\u675F\u4E86\uFF0C\u4E0D\u7528\u518D\u4E0A\u62A5\u5BC6\u7801\u3002";
      case "already":
        return "\u8FD9\u4E2A\u4FDD\u9669\u7BB1\u5DF2\u7ECF\u88AB\u6253\u5F00\u8FC7\u5566\uFF0C\u4E0D\u7528\u518D\u4E0A\u62A5\u4E00\u6B21\u3002";
      case "correct":
        return "\u7834\u89E3\u6210\u529F\uFF01\u5BC6\u7801\u662F\u5BF9\u7684\uFF0C\u4FDD\u9669\u7BB1\u6253\u5F00\u4E86\uFF0C\u5FEB\u606D\u559C\u5BF9\u65B9\u3002";
      default:
        return "\u5BC6\u7801\u4E0D\u5BF9\uFF0C\u4FDD\u9669\u7BB1\u7EB9\u4E1D\u4E0D\u52A8\uFF0C\u8BA9\u5BF9\u65B9\u518D\u60F3\u60F3\u529E\u6CD5\u3002";
    }
  }
  // ==================== 内部工具 ====================
  toCaller(userId, organizationId) {
    return {
      userId,
      organizationId,
      extensionIdentifier: contract.APP_IDENTIFIER
    };
  }
  /** 一个班同时只有一局，用固定 key 让 ClassroomKit 自己处理重开。 */
  sessionKeyFor(organizationId) {
    return `safe-${organizationId}`;
  }
  /**
   * 老师专用接口的权限断言。
   *
   * `getClassroom` 内部已经断言了 `asset:read`（学生没有这个权限），
   * 这里再看一眼 `canManage`，把口径对齐到 `asset:manage`。
   */
  async requireTeacher(caller) {
    const classroom = await this.kit.getClassroom(caller);
    if (!classroom.self.canManage) {
      throw errors.HttpErrorFactory.forbidden("\u53EA\u6709\u8001\u5E08\u53EF\u4EE5\u7BA1\u7406\u7834\u89E3\u4FDD\u9669\u7BB1");
    }
  }
  async tryEndKitSession(caller, sessionKey) {
    try {
      await this.kit.endSession(caller, sessionKey);
    } catch {
    }
  }
  generatePassword(length) {
    let password = "";
    for (let index = 0; index < length; index += 1) {
      password += String(node_crypto.randomInt(10));
    }
    return password;
  }
  /**
   * 渲染这台设备的人设。
   *
   * 允许设备上报时会追加一段工具说明：方糖猫只认提示词和工具表两样东西，
   * 不把"什么时候该调这个工具"写进人设，模型基本不会主动去调。
   */
  renderPrompt(template, participant, allowDeviceReport) {
    const student = participant.studentName?.trim() || participant.agentName;
    const rendered = template.replaceAll(contract.PASSWORD_PLACEHOLDER, () => participant.password).replaceAll(contract.STUDENT_PLACEHOLDER, () => student);
    if (!allowDeviceReport) return rendered;
    return `${rendered}

\u3010\u4E0A\u62A5\u89C4\u5219\u3011\u5F53\u5BF9\u65B9\u62A5\u51FA\u4E00\u4E32\u6570\u5B57\u3001\u60F3\u786E\u8BA4\u662F\u4E0D\u662F\u4FDD\u9669\u7BB1\u5BC6\u7801\u65F6\uFF0C\u8C03\u7528\u5DE5\u5177 ${contract.UNLOCK_TOOL_NAME}\uFF0C\u628A\u90A3\u4E32\u6570\u5B57\u539F\u6837\u653E\u8FDB password \u53C2\u6570\uFF0C\u518D\u7167\u7740\u5DE5\u5177\u8FD4\u56DE\u7684\u8BDD\u56DE\u5E94\u5BF9\u65B9\u3002`;
  }
  async backfillReady(participants, applied, takenOver) {
    const appliedById = new Map(applied.map((item) => [
      item.agentBindingId,
      item
    ]));
    const takenOverIds = new Set(takenOver);
    await Promise.all(participants.map((participant) => {
      const result = appliedById.get(participant.agentBindingId);
      const ready = result?.success === true;
      const readyError = ready ? null : result?.message ?? (takenOverIds.has(participant.agentBindingId) ? "\u63D0\u793A\u8BCD\u6CA1\u6709\u4E0B\u53D1\u5230\u8FD9\u53F0\u65B9\u7CD6\u732B" : "\u8BFB\u4E0D\u5230\u8FD9\u53F0\u65B9\u7CD6\u732B\u7684\u914D\u7F6E\uFF0C\u672C\u5C40\u6CA1\u6709\u63A5\u7BA1\u5B83");
      return this.participantRepository.update({
        id: participant.id
      }, {
        ready,
        readyError
      });
    }));
  }
  findLatestGame(organizationId) {
    return this.sessionRepository.findOne({
      where: {
        organizationId
      },
      order: {
        createdAt: "DESC"
      }
    });
  }
  findRunningGame(organizationId) {
    return this.sessionRepository.findOne({
      where: {
        organizationId,
        status: contract.GameStatus.RUNNING
      },
      order: {
        createdAt: "DESC"
      }
    });
  }
  findParticipants(gameId) {
    return this.participantRepository.find({
      where: {
        sessionId: gameId
      },
      order: {
        agentName: "ASC"
      }
    });
  }
  findParticipantOfStudent(gameId, studentUserId) {
    return this.participantRepository.findOne({
      where: {
        sessionId: gameId,
        studentUserId
      }
    });
  }
  /** 到点之后不再收提交：会话本身也在这个时刻被 ClassroomKit 清理掉。 */
  isOvertime(game) {
    return !!game.endsAt && game.endsAt.getTime() <= Date.now();
  }
  async describeGame(game) {
    const participants = await this.findParticipants(game.id);
    return {
      session: this.toSessionView(game, participants),
      participants: participants.map((participant) => this.toTeacherParticipantView(participant)),
      serverTime: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  toSessionView(game, participants) {
    return {
      id: game.id,
      organizationId: game.organizationId,
      title: game.title,
      status: game.status,
      promptTemplate: game.promptTemplate,
      passwordMode: game.passwordMode,
      passwordLength: game.passwordLength,
      durationMinutes: game.durationMinutes,
      allowDeviceReport: game.allowDeviceReport,
      allowStudentInput: game.allowStudentInput,
      enableStudentView: game.enableStudentView,
      lockStudentEdits: game.lockStudentEdits,
      startedAt: this.toIso(game.startedAt),
      endsAt: this.toIso(game.endsAt),
      endedAt: this.toIso(game.endedAt),
      participantCount: participants.length,
      solvedCount: this.countSolved(participants)
    };
  }
  /** 带密码的参与者视图，只能给老师端用。 */
  toTeacherParticipantView(participant) {
    return {
      id: participant.id,
      agentBindingId: participant.agentBindingId,
      agentName: participant.agentName,
      studentUserId: participant.studentUserId,
      studentName: participant.studentName,
      status: participant.status,
      attempts: participant.attempts,
      solvedAt: this.toIso(participant.solvedAt),
      elapsedMs: participant.elapsedMs,
      solvedVia: participant.solvedVia,
      password: participant.password,
      ready: participant.ready,
      readyError: participant.readyError
    };
  }
  toLeaderboard(participants) {
    const toEntry = /* @__PURE__ */ __name((participant, rank) => ({
      rank,
      agentName: participant.agentName,
      studentName: participant.studentName,
      status: participant.status,
      elapsedMs: participant.elapsedMs,
      solvedVia: participant.solvedVia,
      attempts: participant.attempts
    }), "toEntry");
    const solved = participants.filter((participant) => participant.status === contract.ParticipantStatus.SOLVED).sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0) || a.agentName.localeCompare(b.agentName));
    const racing = participants.filter((participant) => participant.status !== contract.ParticipantStatus.SOLVED).sort((a, b) => b.attempts - a.attempts || a.agentName.localeCompare(b.agentName));
    return [
      ...solved.map((participant, index) => toEntry(participant, index + 1)),
      ...racing.map((participant) => toEntry(participant, null))
    ];
  }
  countSolved(participants) {
    return participants.filter((participant) => participant.status === contract.ParticipantStatus.SOLVED).length;
  }
  clamp(value, range) {
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  }
  toIso(value) {
    return value ? value.toISOString() : null;
  }
  describe(error) {
    return error instanceof Error ? error.message : String(error);
  }
}
GameService = _ts_decorate([
  common.Injectable(),
  _ts_param(0, typeorm.InjectRepository(safeGameSession_entity.SafeGameSession)),
  _ts_param(1, typeorm.InjectRepository(safeGameParticipant_entity.SafeGameParticipant)),
  _ts_param(2, common.Inject(extensionSdk.ClassroomKitService)),
  _ts_metadata("design:type", Function),
  _ts_metadata("design:paramtypes", [
    typeof typeorm$1.Repository === "undefined" ? Object : typeorm$1.Repository,
    typeof typeorm$1.Repository === "undefined" ? Object : typeorm$1.Repository,
    typeof extensionSdk.ClassroomKitService === "undefined" ? Object : extensionSdk.ClassroomKitService
  ])
], GameService);

exports.GameService = GameService;
//# sourceMappingURL=game.service.js.map
//# sourceMappingURL=game.service.js.map