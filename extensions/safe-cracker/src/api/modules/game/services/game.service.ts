import { randomInt } from "node:crypto";

import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";
import {
    type ClassroomApplyResult,
    type ClassroomCaller,
    type ClassroomDevice,
    ClassroomKitService,
    type ClassroomToolDefinition,
} from "@buildingai/extension-sdk";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { SafeGameParticipant } from "../../../db/entities/safe-game-participant.entity";
import { SafeGameSession } from "../../../db/entities/safe-game-session.entity";
import {
    APP_IDENTIFIER,
    type AttemptResult,
    type BoardView,
    DEFAULT_PROMPT_TEMPLATE,
    DURATION_MINUTES_RANGE,
    type GameSessionView,
    GameStatus,
    type LeaderboardEntry,
    ParticipantStatus,
    type ParticipantView,
    PASSWORD_LENGTH_RANGE,
    PASSWORD_PLACEHOLDER,
    PasswordMode,
    type SelectableDevice,
    SolveVia,
    type SolveViaType,
    type StartGamePayload,
    STUDENT_PLACEHOLDER,
    type StudentView,
    type TeacherGameView,
    UNLOCK_TOOL_NAME,
} from "../../../shared/contract";

const DEFAULT_TITLE = "破解保险箱";
const DEFAULT_PASSWORD_LENGTH = 4;
const DEFAULT_DURATION_MINUTES = 15;

/** 恢复接管时的退避重试，见 onModuleInit 的说明。 */
const RESTORE_MAX_ATTEMPTS = 5;
const RESTORE_RETRY_MS = 3_000;

/** 一次提交的判定结果，设备侧和学生侧共用，只是最后落成不同的话术。 */
type UnlockOutcome = {
    kind: "not_running" | "already" | "correct" | "wrong";
    attempts: number;
    elapsedMs: number | null;
};

@Injectable()
export class GameService implements OnModuleInit {
    private readonly logger = new Logger(GameService.name);

    constructor(
        @InjectRepository(SafeGameSession)
        private readonly sessionRepository: Repository<SafeGameSession>,
        @InjectRepository(SafeGameParticipant)
        private readonly participantRepository: Repository<SafeGameParticipant>,
        @Inject(ClassroomKitService)
        private readonly kit: ClassroomKitService,
    ) {}

    // ==================== 重启恢复 ====================

    onModuleInit() {
        // 宿主把工作空间实现注入 ClassroomKit 也是在 onModuleInit 里做的，而应用模块
        // 是动态挂上去的，两边谁先初始化没有保证。所以恢复不阻塞启动，失败了退避重试。
        void this.restoreActiveSessions();
    }

    /**
     * 把重启前还在进行的接管重新武装起来。
     *
     * 工具的 handler 是函数，进程重启后注册表是空的：不 rearm，学生的方糖猫会顶着
     * 游戏人设却没有可调用的上报工具，被隐藏的内置 classroom_report_completion
     * 也会重新冒出来。
     */
    private async restoreActiveSessions(attempt = 1): Promise<void> {
        try {
            if (typeof this.kit?.listActiveSessions !== "function") {
                throw new Error("ClassroomKit 尚未就绪");
            }
            const sessions = await this.kit.listActiveSessions(APP_IDENTIFIER);
            for (const session of sessions) {
                const game = await this.sessionRepository.findOne({
                    where: { kitSessionKey: session.sessionKey, status: GameStatus.RUNNING },
                    order: { createdAt: "DESC" },
                });
                await this.kit.rearmSession(
                    {
                        userId: session.ownerUserId,
                        organizationId: session.organizationId,
                        extensionIdentifier: APP_IDENTIFIER,
                    },
                    session.sessionKey,
                    game?.allowDeviceReport ? this.buildTools(game.id) : [],
                );
            }
            if (sessions.length) {
                this.logger.log(`已恢复 ${sessions.length} 局进行中的破解保险箱`);
            }
        } catch (error) {
            if (attempt < RESTORE_MAX_ATTEMPTS) {
                setTimeout(
                    () => void this.restoreActiveSessions(attempt + 1),
                    attempt * RESTORE_RETRY_MS,
                );
                return;
            }
            this.logger.error(`恢复进行中的破解保险箱失败：${this.describe(error)}`);
        }
    }

    // ==================== 老师侧 ====================

    /**
     * 可选设备。
     *
     * 这里只借 ClassroomKit 的 `asset:read` 断言挡学生，不额外要求 `asset:manage` ——
     * 设备列表本身不含任何游戏机密。
     */
    async listDevices(userId: string, organizationId: string): Promise<SelectableDevice[]> {
        const caller = this.toCaller(userId, organizationId);
        const [devices, sessions] = await Promise.all([
            this.kit.listDevices(caller),
            this.kit.listActiveSessions(APP_IDENTIFIER),
        ]);

        // 本班自己这一局占着的设备不算 busy，否则老师在游戏中途打开选择器会看到满屏"已被接管"。
        const ownSessionIds = new Set(
            sessions
                .filter((session) => session.sessionKey === this.sessionKeyFor(organizationId))
                .map((session) => session.id),
        );

        return devices.map((device) => ({
            agentBindingId: device.agentBindingId,
            name: device.name,
            studentName: device.assignedUserName,
            assignedUserId: device.assignedUserId,
            mcpConnected: device.mcpConnected,
            busy: device.sessionIds.some((sessionId) => !ownSessionIds.has(sessionId)),
        }));
    }

    /** 本班最新一局，含密码，只给老师。 */
    async getCurrent(userId: string, organizationId: string): Promise<TeacherGameView> {
        await this.requireTeacher(this.toCaller(userId, organizationId));
        const game = await this.findLatestGame(organizationId);
        if (!game) return { session: null, participants: [], serverTime: new Date().toISOString() };
        return this.describeGame(game);
    }

    async startGame(
        userId: string,
        organizationId: string,
        payload: StartGamePayload,
    ): Promise<TeacherGameView> {
        const caller = this.toCaller(userId, organizationId);
        await this.requireTeacher(caller);

        const devices = await this.kit.listDevices(caller);
        const deviceById = new Map(devices.map((device) => [device.agentBindingId, device]));
        const selected: ClassroomDevice[] = [];
        const missing: string[] = [];
        for (const agentBindingId of new Set(payload.agentBindingIds)) {
            const device = deviceById.get(agentBindingId);
            if (device) selected.push(device);
            else missing.push(agentBindingId);
        }
        if (missing.length) {
            throw HttpErrorFactory.badRequest("有方糖猫不属于当前班级，请刷新页面后重新选择");
        }

        const passwordMode = payload.passwordMode ?? PasswordMode.PER_STUDENT;
        const passwordLength = this.clamp(
            payload.passwordLength ?? DEFAULT_PASSWORD_LENGTH,
            PASSWORD_LENGTH_RANGE,
        );
        const durationMinutes = this.clamp(
            payload.durationMinutes ?? DEFAULT_DURATION_MINUTES,
            DURATION_MINUTES_RANGE,
        );
        const promptTemplate = payload.promptTemplate?.trim() || DEFAULT_PROMPT_TEMPLATE;
        const allowDeviceReport = payload.allowDeviceReport ?? true;
        const lockStudentEdits = payload.lockStudentEdits ?? true;

        // 老师重开一局时，库里的上一局也要收尾，否则老师面板和学生端会同时看到两局在跑。
        // 设备侧不用管：同一个 sessionKey 再次 startSession，ClassroomKit 会先把上一局正常结束。
        await this.sessionRepository.update(
            { organizationId, status: GameStatus.RUNNING },
            { status: GameStatus.ENDED, endedAt: new Date() },
        );

        const startedAt = new Date();
        const game = await this.sessionRepository.save(
            this.sessionRepository.create({
                organizationId,
                ownerUserId: userId,
                kitSessionKey: this.sessionKeyFor(organizationId),
                title: (payload.title?.trim() || DEFAULT_TITLE).slice(0, 120),
                status: GameStatus.RUNNING,
                promptTemplate,
                passwordMode,
                passwordLength,
                durationMinutes,
                allowDeviceReport,
                allowStudentInput: payload.allowStudentInput ?? true,
                enableStudentView: payload.enableStudentView ?? true,
                lockStudentEdits,
                startedAt,
                endsAt: new Date(startedAt.getTime() + durationMinutes * 60_000),
                endedAt: null,
            }),
        );

        // 密码先落库再接管设备。反过来的话，startSession 下发到一半崩了，
        // 设备上已经是"你守着 4821"的人设，库里却查不到 4821，这局就对不上账了。
        const sharedPassword = this.generatePassword(passwordLength);
        const participants = await this.participantRepository.save(
            selected.map((device) =>
                this.participantRepository.create({
                    sessionId: game.id,
                    agentBindingId: device.agentBindingId,
                    agentName: device.name,
                    studentUserId: device.assignedUserId,
                    studentName: device.assignedUserName,
                    password:
                        passwordMode === PasswordMode.SHARED
                            ? sharedPassword
                            : this.generatePassword(passwordLength),
                    status: ParticipantStatus.RACING,
                    attempts: 0,
                    ready: false,
                    readyError: null,
                }),
            ),
        );

        const prompts: Record<string, string> = {};
        for (const participant of participants) {
            prompts[participant.agentBindingId] = this.renderPrompt(
                promptTemplate,
                participant,
                allowDeviceReport,
            );
        }

        let applied: ClassroomApplyResult[] = [];
        let takenOver: string[] = [];
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
                metadata: { gameId: game.id },
            });
            applied = result.applied;
            takenOver = result.session.agentBindingIds;
        } catch (error) {
            // 一台设备都没接管上，这局没法玩。把它收掉，别让老师停在一个"进行中"却没有设备的局上。
            // 顺手结掉可能已经建起来的接管，免得设备被扣到超时清理才还回去。
            await this.sessionRepository.update(
                { id: game.id },
                { status: GameStatus.ENDED, endedAt: new Date() },
            );
            await this.tryEndKitSession(caller, game.kitSessionKey);
            throw HttpErrorFactory.badRequest(`开始游戏失败：${this.describe(error)}`);
        }

        await this.backfillReady(participants, applied, takenOver);
        return this.describeGame(game);
    }

    async endGame(
        userId: string,
        organizationId: string,
        gameId: string,
    ): Promise<TeacherGameView> {
        const caller = this.toCaller(userId, organizationId);
        // 下面归还设备失败是要吞掉的，所以权限必须在这里单独断言一次，
        // 不能指望 endSession 内部的断言兜底。
        await this.requireTeacher(caller);

        const game = await this.sessionRepository.findOne({
            where: { id: gameId, organizationId },
        });
        if (!game) throw HttpErrorFactory.notFound("这一局游戏不存在");

        if (game.status !== GameStatus.ENDED) {
            try {
                await this.kit.endSession(caller, game.kitSessionKey);
            } catch (error) {
                // 归还设备失败也要把这局落成结束，否则老师会卡在一个点不掉结束的游戏上，
                // 连重开一局都做不到。设备那边还有会话超时兜底，不会永远顶着游戏人设。
                this.logger.error(`结束游戏 ${game.id} 时归还设备失败：${this.describe(error)}`);
            }
        }

        game.status = GameStatus.ENDED;
        game.endedAt = game.endedAt ?? new Date();
        await this.sessionRepository.save(game);
        return this.describeGame(game);
    }

    // ==================== 学生侧 ====================

    async getStudentView(userId: string, organizationId: string): Promise<StudentView> {
        const serverTime = new Date().toISOString();
        const empty: StudentView = {
            session: null,
            ready: false,
            status: null,
            attempts: 0,
            elapsedMs: null,
            agentName: null,
            serverTime,
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
                allowStudentInput: game.allowStudentInput,
            },
            ready: participant.ready,
            status: participant.status,
            attempts: participant.attempts,
            elapsedMs: participant.elapsedMs,
            agentName: participant.agentName,
            serverTime,
        };
    }

    async submitStudentAttempt(
        userId: string,
        organizationId: string,
        password: string,
    ): Promise<AttemptResult> {
        const game = await this.findRunningGame(organizationId);
        if (!game) throw HttpErrorFactory.badRequest("现在没有进行中的破解保险箱");
        if (!game.allowStudentInput) {
            throw HttpErrorFactory.forbidden("本局不能在页面上提交密码，去和你的方糖猫聊聊吧");
        }

        // 只按登录身份找参与者。body 里带什么设备号、什么同学名字都不作数。
        const participant = await this.findParticipantOfStudent(game.id, userId);
        if (!participant) {
            throw HttpErrorFactory.forbidden("你没有参加这一局，先找老师要一台方糖猫");
        }

        const outcome = await this.unlock(game, participant, password, SolveVia.STUDENT);
        return {
            correct: outcome.kind === "correct" || outcome.kind === "already",
            already: outcome.kind === "already",
            attempts: outcome.attempts,
            elapsedMs: outcome.elapsedMs,
            message: this.studentMessage(outcome.kind),
        };
    }

    // ==================== 大屏侧 ====================

    /** 排行榜。这里绝不能出现 password，大屏是全班都在看的。 */
    async getBoard(organizationId: string): Promise<BoardView> {
        const serverTime = new Date().toISOString();
        const game = await this.findLatestGame(organizationId);
        if (!game) return { session: null, entries: [], serverTime };

        const participants = await this.findParticipants(game.id);
        return {
            session: {
                id: game.id,
                title: game.title,
                status: game.status,
                startedAt: this.toIso(game.startedAt),
                endsAt: this.toIso(game.endsAt),
                participantCount: participants.length,
                solvedCount: this.countSolved(participants),
            },
            entries: this.toLeaderboard(participants),
            serverTime,
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
    private buildTools(gameId: string): ClassroomToolDefinition[] {
        return [
            {
                name: UNLOCK_TOOL_NAME,
                title: "上报保险箱密码",
                description:
                    "当对方报出一串数字、想确认是不是保险箱密码时调用。把那串数字原样放进 password，" +
                    "然后照着返回的话回应对方。对错由这个工具判定，不要自己下结论。",
                inputSchema: {
                    type: "object",
                    properties: {
                        password: {
                            type: "string",
                            description: "对方说出的密码，纯数字",
                        },
                    },
                    required: ["password"],
                },
                handler: async (args, context) => {
                    const [game, participant] = await Promise.all([
                        this.sessionRepository.findOne({ where: { id: gameId } }),
                        this.participantRepository.findOne({
                            where: { sessionId: gameId, agentBindingId: context.agentBindingId },
                        }),
                    ]);
                    if (!game || !participant) {
                        return "你没有参加这一局破解保险箱，先别管保险箱的事。";
                    }

                    const outcome = await this.unlock(
                        game,
                        participant,
                        String(args.password ?? ""),
                        SolveVia.DEVICE,
                    );
                    return this.deviceMessage(outcome.kind);
                },
            },
        ];
    }

    // ==================== 判定 ====================

    private async unlock(
        game: SafeGameSession,
        participant: SafeGameParticipant,
        raw: string,
        via: SolveViaType,
    ): Promise<UnlockOutcome> {
        if (game.status !== GameStatus.RUNNING || this.isOvertime(game)) {
            return {
                kind: "not_running",
                attempts: participant.attempts,
                elapsedMs: participant.elapsedMs,
            };
        }
        if (participant.status === ParticipantStatus.SOLVED) {
            return {
                kind: "already",
                attempts: participant.attempts,
                elapsedMs: participant.elapsedMs,
            };
        }

        // 方糖猫转述过来的密码常带标点或"密码是"这类前缀。密码本身只有数字，去掉非数字不会误伤。
        const guess = raw.replace(/\D/g, "");
        if (!guess) {
            return { kind: "wrong", attempts: participant.attempts, elapsedMs: null };
        }

        await this.participantRepository.increment({ id: participant.id }, "attempts", 1);

        let claimed = false;
        if (guess === participant.password) {
            const solvedAt = new Date();
            const startedAt = game.startedAt ?? game.createdAt;
            // 设备和学生端可能同时报对同一个密码，先查后写会让两条路都算自己是第一名。
            // 交给数据库做条件更新，只有真正把 racing 改成 solved 的那一次才算破解。
            const updated = await this.participantRepository.update(
                { id: participant.id, status: ParticipantStatus.RACING },
                {
                    status: ParticipantStatus.SOLVED,
                    solvedAt,
                    elapsedMs: Math.max(0, solvedAt.getTime() - startedAt.getTime()),
                    solvedVia: via,
                },
            );
            claimed = (updated.affected ?? 0) > 0;
        }

        const latest =
            (await this.participantRepository.findOne({ where: { id: participant.id } })) ??
            participant;
        if (guess !== participant.password) {
            return { kind: "wrong", attempts: latest.attempts, elapsedMs: null };
        }
        return {
            kind: claimed ? "correct" : "already",
            attempts: latest.attempts,
            elapsedMs: latest.elapsedMs,
        };
    }

    private studentMessage(kind: UnlockOutcome["kind"]): string {
        switch (kind) {
            case "not_running":
                return "这一局已经结束啦";
            case "already":
                return "你已经破解过这个保险箱了";
            case "correct":
                return "破解成功！保险箱打开了";
            default:
                return "密码不对，再去套一套你的方糖猫";
        }
    }

    /** 返回给方糖猫的文本，它会照着念，所以写成一句能直接说出口的话。 */
    private deviceMessage(kind: UnlockOutcome["kind"]): string {
        switch (kind) {
            case "not_running":
                return "这一局破解保险箱已经结束了，不用再上报密码。";
            case "already":
                return "这个保险箱已经被打开过啦，不用再上报一次。";
            case "correct":
                return "破解成功！密码是对的，保险箱打开了，快恭喜对方。";
            default:
                return "密码不对，保险箱纹丝不动，让对方再想想办法。";
        }
    }

    // ==================== 内部工具 ====================

    private toCaller(userId: string, organizationId: string): ClassroomCaller {
        return { userId, organizationId, extensionIdentifier: APP_IDENTIFIER };
    }

    /** 一个班同时只有一局，用固定 key 让 ClassroomKit 自己处理重开。 */
    private sessionKeyFor(organizationId: string): string {
        return `safe-${organizationId}`;
    }

    /**
     * 老师专用接口的权限断言。
     *
     * `getClassroom` 内部已经断言了 `asset:read`（学生没有这个权限），
     * 这里再看一眼 `canManage`，把口径对齐到 `asset:manage`。
     */
    private async requireTeacher(caller: ClassroomCaller): Promise<void> {
        const classroom = await this.kit.getClassroom(caller);
        if (!classroom.self.canManage) {
            throw HttpErrorFactory.forbidden("只有老师可以管理破解保险箱");
        }
    }

    private async tryEndKitSession(caller: ClassroomCaller, sessionKey: string): Promise<void> {
        try {
            await this.kit.endSession(caller, sessionKey);
        } catch {
            // 大多数情况是本来就没有接管成功，没有会话可结束，不值得再往上抛。
        }
    }

    private generatePassword(length: number): string {
        let password = "";
        for (let index = 0; index < length; index += 1) {
            password += String(randomInt(10));
        }
        return password;
    }

    /**
     * 渲染这台设备的人设。
     *
     * 允许设备上报时会追加一段工具说明：方糖猫只认提示词和工具表两样东西，
     * 不把"什么时候该调这个工具"写进人设，模型基本不会主动去调。
     */
    private renderPrompt(
        template: string,
        participant: SafeGameParticipant,
        allowDeviceReport: boolean,
    ): string {
        const student = participant.studentName?.trim() || participant.agentName;
        const rendered = template
            .replaceAll(PASSWORD_PLACEHOLDER, () => participant.password)
            .replaceAll(STUDENT_PLACEHOLDER, () => student);
        if (!allowDeviceReport) return rendered;
        return `${rendered}\n\n【上报规则】当对方报出一串数字、想确认是不是保险箱密码时，调用工具 ${UNLOCK_TOOL_NAME}，把那串数字原样放进 password 参数，再照着工具返回的话回应对方。`;
    }

    private async backfillReady(
        participants: SafeGameParticipant[],
        applied: ClassroomApplyResult[],
        takenOver: string[],
    ): Promise<void> {
        const appliedById = new Map(applied.map((item) => [item.agentBindingId, item]));
        const takenOverIds = new Set(takenOver);

        await Promise.all(
            participants.map((participant) => {
                const result = appliedById.get(participant.agentBindingId);
                const ready = result?.success === true;
                const readyError = ready
                    ? null
                    : (result?.message ??
                      (takenOverIds.has(participant.agentBindingId)
                          ? "提示词没有下发到这台方糖猫"
                          : "读不到这台方糖猫的配置，本局没有接管它"));
                return this.participantRepository.update(
                    { id: participant.id },
                    { ready, readyError },
                );
            }),
        );
    }

    private findLatestGame(organizationId: string) {
        return this.sessionRepository.findOne({
            where: { organizationId },
            order: { createdAt: "DESC" },
        });
    }

    private findRunningGame(organizationId: string) {
        return this.sessionRepository.findOne({
            where: { organizationId, status: GameStatus.RUNNING },
            order: { createdAt: "DESC" },
        });
    }

    private findParticipants(gameId: string) {
        return this.participantRepository.find({
            where: { sessionId: gameId },
            order: { agentName: "ASC" },
        });
    }

    private findParticipantOfStudent(gameId: string, studentUserId: string) {
        return this.participantRepository.findOne({
            where: { sessionId: gameId, studentUserId },
        });
    }

    /** 到点之后不再收提交：会话本身也在这个时刻被 ClassroomKit 清理掉。 */
    private isOvertime(game: SafeGameSession): boolean {
        return !!game.endsAt && game.endsAt.getTime() <= Date.now();
    }

    private async describeGame(game: SafeGameSession): Promise<TeacherGameView> {
        const participants = await this.findParticipants(game.id);
        return {
            session: this.toSessionView(game, participants),
            participants: participants.map((participant) =>
                this.toTeacherParticipantView(participant),
            ),
            serverTime: new Date().toISOString(),
        };
    }

    private toSessionView(
        game: SafeGameSession,
        participants: SafeGameParticipant[],
    ): GameSessionView {
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
            solvedCount: this.countSolved(participants),
        };
    }

    /** 带密码的参与者视图，只能给老师端用。 */
    private toTeacherParticipantView(participant: SafeGameParticipant): ParticipantView {
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
            readyError: participant.readyError,
        };
    }

    private toLeaderboard(participants: SafeGameParticipant[]): LeaderboardEntry[] {
        const toEntry = (
            participant: SafeGameParticipant,
            rank: number | null,
        ): LeaderboardEntry => ({
            rank,
            agentName: participant.agentName,
            studentName: participant.studentName,
            status: participant.status,
            elapsedMs: participant.elapsedMs,
            solvedVia: participant.solvedVia,
            attempts: participant.attempts,
        });

        // 耗时相同的话按名字兜底，保证同一份数据每次刷新出来的名次一致。
        const solved = participants
            .filter((participant) => participant.status === ParticipantStatus.SOLVED)
            .sort(
                (a, b) =>
                    (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0) ||
                    a.agentName.localeCompare(b.agentName),
            );
        const racing = participants
            .filter((participant) => participant.status !== ParticipantStatus.SOLVED)
            .sort((a, b) => b.attempts - a.attempts || a.agentName.localeCompare(b.agentName));

        return [
            ...solved.map((participant, index) => toEntry(participant, index + 1)),
            ...racing.map((participant) => toEntry(participant, null)),
        ];
    }

    private countSolved(participants: SafeGameParticipant[]): number {
        return participants.filter((participant) => participant.status === ParticipantStatus.SOLVED)
            .length;
    }

    private clamp(value: number, range: { min: number; max: number }): number {
        return Math.min(range.max, Math.max(range.min, Math.round(value)));
    }

    private toIso(value: Date | null | undefined): string | null {
        return value ? value.toISOString() : null;
    }

    private describe(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
