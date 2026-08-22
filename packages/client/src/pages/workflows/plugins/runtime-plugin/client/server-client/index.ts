/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useAuthStore } from "@buildingai/stores";
import { injectable } from "@flowgram.ai/free-layout-editor";
import type {
  IRuntimeClient,
  TaskCancelInput,
  TaskCancelOutput,
  TaskReportInput,
  TaskReportOutput,
  TaskResultInput,
  TaskResultOutput,
  TaskRunInput,
  TaskRunOutput,
  TaskValidateInput,
  TaskValidateOutput,
} from "@flowgram.ai/runtime-interface";
import {
  FlowGramAPIName,
  TaskCancelDefine,
  TaskReportDefine,
  TaskResultDefine,
  TaskRunDefine,
  TaskValidateDefine,
} from "@flowgram.ai/runtime-interface";

import type { ServerConfig } from "../../type";
import { DEFAULT_SERVER_CONFIG } from "./constant";
import type { ServerError } from "./type";

interface StandardApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

@injectable()
export class WorkflowRuntimeServerClient implements IRuntimeClient {
  private config: ServerConfig = DEFAULT_SERVER_CONFIG;

  constructor() {}

  public init(config: ServerConfig) {
    this.config = config;
  }

  public async [FlowGramAPIName.TaskRun](input: TaskRunInput): Promise<TaskRunOutput | undefined> {
    return this.request<TaskRunOutput>(TaskRunDefine.path, TaskRunDefine.method, {
      body: input,
      errorMessage: "TaskRun failed",
    });
  }

  public async [FlowGramAPIName.TaskReport](
    input: TaskReportInput,
  ): Promise<TaskReportOutput | undefined> {
    return this.request<TaskReportOutput>(TaskReportDefine.path, TaskReportDefine.method, {
      queryParams: { taskID: input.taskID },
      errorMessage: "TaskReport failed",
    });
  }

  public async [FlowGramAPIName.TaskResult](
    input: TaskResultInput,
  ): Promise<TaskResultOutput | undefined> {
    return this.request<TaskResultOutput>(TaskResultDefine.path, TaskResultDefine.method, {
      queryParams: { taskID: input.taskID },
      errorMessage: "TaskResult failed",
      fallbackValue: { success: false },
    });
  }

  public async [FlowGramAPIName.TaskCancel](input: TaskCancelInput): Promise<TaskCancelOutput> {
    const result = await this.request<TaskCancelOutput>(
      TaskCancelDefine.path,
      TaskCancelDefine.method,
      {
        body: input,
        errorMessage: "TaskCancel failed",
        fallbackValue: { success: false },
      },
    );
    return result ?? { success: false };
  }

  public async [FlowGramAPIName.TaskValidate](
    input: TaskValidateInput,
  ): Promise<TaskValidateOutput | undefined> {
    return this.request<TaskValidateOutput>(TaskValidateDefine.path, TaskValidateDefine.method, {
      body: input,
      errorMessage: "TaskValidate failed",
    });
  }

  // Generic request method to reduce code duplication
  private async request<T>(
    path: string,
    method: string,
    options: {
      body?: unknown;
      queryParams?: Record<string, string>;
      errorMessage: string;
      fallbackValue?: T;
    },
  ): Promise<T | undefined> {
    try {
      const url = this.url(path, options.queryParams);
      const requestOptions: RequestInit = {
        method,
        redirect: "follow",
      };

      if (options.body) {
        requestOptions.body = JSON.stringify(options.body);
      }

      requestOptions.headers = this.headers(Boolean(options.body));

      const response = await fetch(url, requestOptions);
      const payload = await this.readJson(response);
      const output = this.unwrapResponse<T>(payload);

      if (!response.ok || this.isError(output)) {
        const message =
          this.isError(output) && output.message ? output.message : options.errorMessage;
        console.error(options.errorMessage, output);
        if (options.fallbackValue !== undefined) return options.fallbackValue;
        throw new Error(message);
      }

      return output;
    } catch (error) {
      console.error(error);
      if (options.fallbackValue !== undefined) return options.fallbackValue;
      throw error instanceof Error ? error : new Error(options.errorMessage);
    }
  }

  private headers(hasBody: boolean): Headers {
    const headers = new Headers();
    const token = useAuthStore.getState().auth.token;

    if (hasBody) {
      headers.set("Content-Type", "application/json");
    }

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    return JSON.parse(text);
  }

  private unwrapResponse<T>(payload: unknown): T | ServerError | undefined {
    if (this.isStandardApiEnvelope<T>(payload)) {
      if (payload.code >= 20000 && payload.code < 30000) {
        return payload.data;
      }
      return {
        code: payload.code,
        message: payload.message,
      };
    }

    return payload as T | ServerError | undefined;
  }

  // Build URL with query parameters
  private url(path: string, queryParams?: Record<string, string>): string {
    const baseURL = this.getURL(`/api${path}`);
    if (!queryParams) {
      return baseURL;
    }

    const searchParams = new URLSearchParams(queryParams);
    return `${baseURL}?${searchParams.toString()}`;
  }

  private isError(output: unknown | undefined): output is ServerError {
    return !!output && (output as ServerError).code !== undefined;
  }

  private isStandardApiEnvelope<T>(payload: unknown): payload is StandardApiEnvelope<T> {
    return (
      !!payload &&
      typeof payload === "object" &&
      typeof (payload as StandardApiEnvelope<T>).code === "number" &&
      typeof (payload as StandardApiEnvelope<T>).message === "string" &&
      "data" in payload
    );
  }

  private getURL(path: string): string {
    const protocol = (this.config.protocol ?? window.location.protocol).replace(/:$/, "");
    const host = this.config.port
      ? `${this.config.domain}:${this.config.port}`
      : this.config.domain;
    return `${protocol}://${host}${path}`;
  }
}
