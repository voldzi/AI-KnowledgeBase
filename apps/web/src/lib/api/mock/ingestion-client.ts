import type {
  ApiRequestContext,
  CreateIngestionJobRequest,
  IngestionApiClient,
  IngestionJob,
  IngestionReport
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { cloneMock, mockIngestionJobs, mockReports } from "./data";

export class MockIngestionClient implements IngestionApiClient {
  private readonly jobs = cloneMock(mockIngestionJobs);
  private readonly reports = cloneMock(mockReports);

  async listJobs(_context: ApiRequestContext): Promise<IngestionJob[]> {
    return cloneMock(this.jobs);
  }

  async getJob(jobId: string, _context: ApiRequestContext): Promise<IngestionJob> {
    const job = this.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) {
      throw new ApiClientError("Ingestion job not found", 404, "INGESTION_JOB_NOT_FOUND", "mock-trace");
    }
    return cloneMock(job);
  }

  async createJob(request: CreateIngestionJobRequest, _context: ApiRequestContext): Promise<IngestionJob> {
    const job: IngestionJob = {
      job_id: `ing_${this.jobs.length + 400}`,
      status: "queued",
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      ...request
    };
    this.jobs.unshift(job);
    return cloneMock(job);
  }

  async getReport(jobId: string, _context: ApiRequestContext): Promise<IngestionReport> {
    const report = this.reports.find((candidate) => candidate.job_id === jobId);
    if (!report) {
      return {
        job_id: jobId,
        status: "running",
        documents_processed: 0,
        pages_processed: 18,
        chunks_created: 64,
        tables_detected: 2,
        ocr_used: true,
        warnings: [],
        errors: []
      };
    }
    return cloneMock(report);
  }

  async cancelJob(jobId: string, _context: ApiRequestContext): Promise<IngestionJob> {
    const job = this.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) {
      throw new ApiClientError("Ingestion job not found", 404, "INGESTION_JOB_NOT_FOUND", "mock-trace");
    }
    job.status = "cancelled";
    job.finished_at = new Date().toISOString();
    return cloneMock(job);
  }
}
