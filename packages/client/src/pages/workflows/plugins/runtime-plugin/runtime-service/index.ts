/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type {
  interfaces,
  WorkflowLineEntity,
  WorkflowNodeEntity,
} from "@flowgram.ai/free-layout-editor";
import {
  Emitter,
  inject,
  injectable,
  Playground,
  WorkflowDocument,
} from "@flowgram.ai/free-layout-editor";
import type {
  IReport,
  NodeReport,
  WorkflowInputs,
  WorkflowOutputs,
} from "@flowgram.ai/runtime-interface";
import { WorkflowStatus } from "@flowgram.ai/runtime-interface";

import { WorkflowNodeType } from "../../../nodes";
import { GetGlobalVariableSchema } from "../../variable-panel-plugin";
import { WorkflowRuntimeClient } from "../client";

const SYNC_TASK_REPORT_INTERVAL = 500;

/** Stable across Vite HMR; class identity is not. */
export const WorkflowRuntimeServiceId = Symbol.for("CubeMax.WorkflowRuntimeService");

export function getWorkflowRuntimeService(
  container: Pick<interfaces.Container, "get" | "isBound"> | undefined,
): WorkflowRuntimeService | undefined {
  if (!container) return undefined;
  const ids: interfaces.ServiceIdentifier<WorkflowRuntimeService>[] = [
    WorkflowRuntimeServiceId,
    WorkflowRuntimeService,
  ];
  for (const id of ids) {
    if (!container.isBound(id)) continue;
    try {
      return container.get(id);
    } catch {
      continue;
    }
  }
  return undefined;
}

type WorkflowRuntimeRequestContext = {
  projectId?: string;
};

interface NodeRunningStatus {
  nodeID: string;
  status: WorkflowStatus;
  nodeResultLength: number;
}

@injectable()
export class WorkflowRuntimeService {
  @inject(Playground) playground: Playground;

  @inject(WorkflowDocument) document: WorkflowDocument;

  @inject(WorkflowRuntimeClient) runtimeClient: WorkflowRuntimeClient;

  @inject(GetGlobalVariableSchema) getGlobalVariableSchema: GetGlobalVariableSchema;

  private runningNodes: WorkflowNodeEntity[] = [];

  private taskID?: string;

  private syncTaskReportIntervalID?: ReturnType<typeof setInterval>;

  private reportEmitter = new Emitter<NodeReport>();

  private resetEmitter = new Emitter<{}>();

  private resultEmitter = new Emitter<{
    errors?: string[];
    result?: {
      inputs: WorkflowInputs;
      outputs: WorkflowOutputs;
    };
  }>();

  private nodeRunningStatus: Map<string, NodeRunningStatus>;

  private runtimeContext: WorkflowRuntimeRequestContext = {};

  public onNodeReportChange = this.reportEmitter.event;

  public onReset = this.resetEmitter.event;

  public onResultChanged = this.resultEmitter.event;

  public isFlowingLine(line: WorkflowLineEntity) {
    return this.runningNodes.some((node) => node.lines.inputLines.includes(line));
  }

  public setRuntimeContext(context?: WorkflowRuntimeRequestContext): void {
    this.runtimeContext = context ?? {};
  }

  public async taskRun(inputs: WorkflowInputs): Promise<string | undefined> {
    if (this.taskID) {
      await this.taskCancel();
    }
    const isFormValid = await this.validateForm();
    if (!isFormValid) {
      this.resultEmitter.fire({
        errors: ["表单校验失败"],
      });
      return;
    }
    const schema = {
      ...this.document.toJSON(),
      globalVariable: this.getGlobalVariableSchema(),
    };

    let validateResult: Awaited<ReturnType<WorkflowRuntimeClient["TaskValidate"]>>;
    try {
      validateResult = await this.runtimeClient.TaskValidate({
        schema: JSON.stringify(schema),
        inputs,
        context: this.runtimeContext,
      } as Parameters<WorkflowRuntimeClient["TaskValidate"]>[0]);
    } catch (error) {
      this.resultEmitter.fire({
        errors: [(error as Error)?.message || "工作流校验失败"],
      });
      return;
    }
    if (!validateResult?.valid) {
      this.resultEmitter.fire({
        errors: validateResult?.errors?.length
          ? validateResult.errors
          : ["工作流校验失败"],
      });
      return;
    }
    this.reset();
    let taskID: string | undefined;
    try {
      const output = await this.runtimeClient.TaskRun({
        schema: JSON.stringify(schema),
        inputs,
        context: this.runtimeContext,
      } as Parameters<WorkflowRuntimeClient["TaskRun"]>[0]);
      taskID = output?.taskID;
    } catch (e) {
      this.resultEmitter.fire({
        errors: [(e as Error)?.message],
      });
      return;
    }
    if (!taskID) {
      this.resultEmitter.fire({
        errors: ["任务运行失败"],
      });
      return;
    }
    this.taskID = taskID;
    this.syncTaskReportIntervalID = setInterval(() => {
      this.syncTaskReport();
    }, SYNC_TASK_REPORT_INTERVAL);
    return this.taskID;
  }

  public async taskCancel(): Promise<void> {
    if (!this.taskID) {
      return;
    }
    await this.runtimeClient.TaskCancel({
      taskID: this.taskID,
    });
  }

  private async validateForm(): Promise<boolean> {
    const allForms = this.document.getAllNodes().map((node) => node.form);
    const formValidations = await Promise.all(allForms.map(async (form) => form?.validate()));
    const validations = formValidations.filter((validation) => validation !== undefined);
    const isValid = validations.every((validation) => validation);
    return isValid;
  }

  private reset(): void {
    this.taskID = undefined;
    this.nodeRunningStatus = new Map();
    this.runningNodes = [];
    if (this.syncTaskReportIntervalID) {
      clearInterval(this.syncTaskReportIntervalID);
    }
    this.resetEmitter.fire({});
  }

  private async syncTaskReport(): Promise<void> {
    if (!this.taskID) {
      return;
    }
    const report = await this.runtimeClient.TaskReport({
      taskID: this.taskID,
    });
    if (!report) {
      clearInterval(this.syncTaskReportIntervalID);
      console.error("Sync task report failed");
      return;
    }
    const { workflowStatus, inputs, outputs, messages } = report;
    if (workflowStatus.terminated) {
      clearInterval(this.syncTaskReportIntervalID);
      if (Object.keys(outputs).length > 0) {
        this.resultEmitter.fire({ result: { inputs, outputs } });
      } else {
        this.resultEmitter.fire({
          errors: messages?.error?.map((message) =>
            message.nodeID ? `${message.nodeID}: ${message.message}` : message.message,
          ),
        });
      }
    }
    this.updateReport(report);
  }

  private updateReport(report: IReport): void {
    const { reports } = report;
    this.runningNodes = [];
    this.document
      .getAllNodes()
      .filter(
        (node) =>
          ![WorkflowNodeType.BlockStart, WorkflowNodeType.BlockEnd].includes(
            node.flowNodeType as WorkflowNodeType,
          ),
      )
      .forEach((node) => {
        const nodeID = node.id;
        const nodeReport = reports[nodeID];
        if (!nodeReport) {
          return;
        }
        if (nodeReport.status === WorkflowStatus.Processing) {
          this.runningNodes.push(node);
        }
        const runningStatus = this.nodeRunningStatus.get(nodeID);
        if (
          !runningStatus ||
          nodeReport.status !== runningStatus.status ||
          nodeReport.snapshots.length !== runningStatus.nodeResultLength
        ) {
          this.nodeRunningStatus.set(nodeID, {
            nodeID,
            status: nodeReport.status,
            nodeResultLength: nodeReport.snapshots.length,
          });
          this.reportEmitter.fire(nodeReport);
          this.document.linesManager.forceUpdate();
        } else if (nodeReport.status === WorkflowStatus.Processing) {
          this.reportEmitter.fire(nodeReport);
        }
      });
  }
}
