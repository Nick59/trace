export interface ReviewFile { path:string; status:string; additions:number; deletions:number; patch:string; source?:string }
export interface PullRequestSummary { title:string; url:string; repository:string; number:number; author:string; base:string; head:string; headSha:string }
export interface PullRequestSnapshot extends PullRequestSummary { description:string; files:ReviewFile[]; warnings:string[] }
export type EntrypointKind = 'http'|'cli'|'job'|'event'|'ui'|'other';
export interface WorkflowStep { id:string; title:string; summary:string; path:string; symbols:string[]; checks:string[] }
export interface WorkflowEdge { from:string; to:string; label?:string }
export interface Workflow { id:string; position:number; title:string; entrypoint:{ kind:EntrypointKind; label:string }; summary:string; steps:WorkflowStep[]; edges:WorkflowEdge[] }
export type AnalysisStatus = 'draft'|'ready';
export type AnalysisSource = 'agent'|'api';
export interface Analysis { id:string; repository:string; number:number; headSha:string; status:AnalysisStatus; source:AnalysisSource|null; pr:PullRequestSnapshot; workflows:Workflow[]; createdAt:string; updatedAt:string }
