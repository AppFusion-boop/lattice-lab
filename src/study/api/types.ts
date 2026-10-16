import type { components } from "../../api/schema";

export type Study = components["schemas"]["StudyResponse"];
export type StudyCreate = components["schemas"]["StudyCreate"];
export type StudyUpdate = components["schemas"]["StudyUpdate"];

export type Parameter = components["schemas"]["ParameterResponse"];
export type ParameterCreate = components["schemas"]["ParameterCreate"];
export type ParameterUpdate = components["schemas"]["ParameterUpdate"];

export type Outcome = components["schemas"]["OutcomeResponse"];
export type OutcomeCreate = components["schemas"]["OutcomeCreate"];
export type OutcomeUpdate = components["schemas"]["OutcomeUpdate"];

export type Constraint = components["schemas"]["ConstraintResponse"];
export type ConstraintCreate = components["schemas"]["ConstraintCreate"];
export type ConstraintUpdate = components["schemas"]["ConstraintUpdate"];

export type CandidateSet = components["schemas"]["CandidateSetResponse"];
export type Candidate = components["schemas"]["CandidateResponse"];
export type PaginatedCandidates = components["schemas"]["PaginatedCandidatesResponse"];

export type Job = components["schemas"]["JobResponse"];
export type ScreeningRun = components["schemas"]["ScreeningRunResponse"];
export type ScreeningSummary = components["schemas"]["ScreeningSummary"];
export type ScreeningFunnel = components["schemas"]["ScreeningFunnel"];

export type Override = components["schemas"]["OverrideResponse"];
export type OverrideCreate = components["schemas"]["OverrideCreate"];

export type Source = components["schemas"]["SourceResponse"];
export type SourceCreate = components["schemas"]["SourceCreate"];

export type Evidence = components["schemas"]["EvidenceResponse"];
export type EvidenceCreate = components["schemas"]["EvidenceCreate"];
export type EvidenceRetractRequest = components["schemas"]["EvidenceRetractRequest"];

export type ImportPreview = components["schemas"]["ImportPreviewResponse"];
export type ImportCommitRequest = components["schemas"]["ImportCommitRequest"];
export type ImportCommitResponse = components["schemas"]["ImportCommitResponse"];

export type RunSheet = components["schemas"]["RunSheetResponse"];
export type RunSheetCreate = components["schemas"]["RunSheetCreate"];
export type RunSheetImportResponse = components["schemas"]["RunSheetImportResponse"];

export type AuditEntry = components["schemas"]["AuditEntryResponse"];
export type AuditLog = components["schemas"]["AuditLogResponse"];
export type Backup = components["schemas"]["BackupResponse"];

export type ModelVersion = components["schemas"]["ModelVersionResponse"];
export type ModelVersionCreate = components["schemas"]["ModelVersionCreate"];
export type ParameterBindingModel = components["schemas"]["ParameterBindingModel"];
export type OutcomeBindingModel = components["schemas"]["OutcomeBindingModel"];

export type SensitivityRequest = components["schemas"]["SensitivityRequest"];
export type SensitivityResponse = components["schemas"]["SensitivityResponse"];
export type ParameterSensitivity = components["schemas"]["ParameterSensitivityModel"];
export type FreezingRecommendation = components["schemas"]["FreezingRecommendationModel"];
export type ParetoResponse = components["schemas"]["ParetoResponse"];
export type ParetoPoint = components["schemas"]["ParetoPointModel"];

export type CalibrationRequest = components["schemas"]["CalibrationRequest"];
export type CalibrationResponse = components["schemas"]["CalibrationResponse"];
export type CalibrationApplyRequest = components["schemas"]["CalibrationApplyRequest"];
