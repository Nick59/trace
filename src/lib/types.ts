export interface ReviewFile { path:string; status:string; additions:number; deletions:number; patch:string; source?:string }
export interface PullRequestSummary { title:string; url:string; repository:string; number:number; author:string; base:string; head:string; headSha:string }
export interface PullRequestSnapshot extends PullRequestSummary { description:string; files:ReviewFile[]; warnings:string[] }
export type EntrypointKind = 'http'|'cli'|'job'|'event'|'ui'|'other';
export interface StepRange { from:number; to:number }
export interface WorkflowStep { id:string; title:string; summary:string; path:string; paths:string[]; symbols:string[]; checks:string[]; ranges?:StepRange[] }
export interface WorkflowEdge { from:string; to:string; label?:string }
export interface Workflow { id:string; position:number; title:string; feature?:string; actor?:string; entrypoint:{ kind:EntrypointKind; label:string }; summary:string; steps:WorkflowStep[]; edges:WorkflowEdge[] }
export type AnalysisStatus = 'draft'|'ready';
export type AnalysisSource = 'agent'|'api';
export interface UnassignedFile { path:string; reason:string }
export interface Analysis { id:string; repository:string; number:number; headSha:string; status:AnalysisStatus; source:AnalysisSource|null; pr:PullRequestSnapshot; workflows:Workflow[]; unassigned:UnassignedFile[]; createdAt:string; updatedAt:string }

export type CommentSide = 'LEFT' | 'RIGHT';
/** A GitHub pull request review comment. `line` is null for file comments and for comments that do not map onto the analyzed commit. */
export interface ReviewComment { id: number; author: string; body: string; url: string; createdAt: string; path: string; side: CommentSide; line: number | null; startLine: number | null; file: boolean; replyTo: number | null }
/** Without `line` the comment targets the whole file. */
export interface NewReviewComment { path: string; body: string; side?: CommentSide; line?: number; startLine?: number }
