export interface LoginResponse {
  user:         User;
  accessToken:  string;
  refreshToken: string;
}

export interface User {
  id:   number;
  name: string;
  role: string;
}

export enum Role {
ADMIN = "admin",
USER = "user",
}

export interface Step {
title: string;
description: string;
}

export type DocumentType = "id-card" | "drivers-license" | "passport" | "disability-certificate" | "kra-pin-certificate";

export interface UploadProgressProps {
progress: number;
fileName?: string;
onCancel: () => void;
onRetry: () => void;
isUploading: boolean;
isError: boolean;
}

export interface FileUploadResponse {
url: string;
name: string;
}

// Combined VerificationResponse interface
export interface VerificationResponse {
message: string;
document_verification: Array<{
  documentName: string;
  text: string;
  verification_data: Array<{
    type: string;
    fraudFlag: string;
    normalizedValue: string;
  }>;
}>;
face_match: {
  face_match: boolean;
  details: {
    similarity: number;
    confidence: number;
  };
};
riskLevel: RiskLevel;
score?: number;
reasons: string[];
requiresReview: boolean;
matchedEntity?: MatchedEntity;
}

// Topic mapping type
export type TopicMap = {
[key: string]: string
}

// Risk level type
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH"

// Detailed entity interface for high/medium risk cases
export interface MatchedEntity {
id: string;
caption: string;
schema: string;
properties: {
  alias?: string[];
  birthDate?: string[];
  title?: string[];
  gender?: string[];
  position?: string[];
  name?: string[];
  lastName?: string[];
  website?: string[];
  education?: string[];
  wikidataId?: string[];
  firstName?: string[];
  topics?: string[];
  birthPlace?: string[];
  notes?: string[];
  citizenship?: string[];
  country?: string[];
  sourceUrl?: string[];
  weakAlias?: string[];
  religion?: string[];
  ethnicity?: string[];
  positionOccupancies?: PositionOccupancy[];
  associates?: Associate[];
  familyRelative?: FamilyRelative[];
  [key: string]: any;
};
datasets?: string[];
referents?: string[];
target?: boolean;
first_seen?: string;
last_seen?: string;
last_change?: string;
}

export interface PositionOccupancy {
id?: string;
caption?: string;
schema?: string;
properties: {
  status?: string[];
  holder?: string[];
  startDate?: string[];
  post?: Post[];
  [key: string]: any;
};
datasets?: string[];
referents?: string[];
target?: boolean;
first_seen?: string;
last_seen?: string;
last_change?: string;
}

export interface Post {
id?: string;
caption?: string;
schema?: string;
properties: {
  topics?: string[];
  country?: string[];
  name?: string[];
  [key: string]: any;
};
datasets?: string[];
referents?: string[];
target?: boolean;
first_seen?: string;
last_seen?: string;
last_change?: string;
}

export interface Associate {
id?: string;
caption?: string;
schema?: string;
properties: {
  relationship?: string[];
  associate?: any;
  person?: string[];
  [key: string]: any;
};
datasets?: string[];
referents?: string[];
target?: boolean;
first_seen?: string;
last_seen?: string;
last_change?: string;
}

// Family relative with embedded entity-like relatives
export interface FamilyRelative {
id?: string;
caption?: string;
schema?: string;
properties: {
  person?: any;
  relationship?: string[];
  relative?: RelativeEntity[];
  startDate?: string[];
  sourceUrl?: string[];
  [key: string]: any;
};
datasets?: string[];
referents?: string[];
target?: boolean;
first_seen?: string;
last_seen?: string;
last_change?: string;
}

// Type for relative entities in family relationships
export interface RelativeEntity {
id: string;
caption: string;
properties: {
  topics?: string[];
  [key: string]: any;
};
datasets: string[];
}

// For displaying in the UI
export interface PoliticalExposureItem {
position: string;
startDate: string;
endDate: string;
location: string;
}

export interface InternationalExposureItem {
position?: string;
nature?: string;
startDate: string;
endDate: string;
location: string;
}

export interface SanctionItem {
authority1: string;
authority2: string;
from: string;
reason: string;
}

export interface PepDatabaseItem {
name?: string;
relationType?: string;
person?: string;
topics: string[];
score: number;
sources: string;
}

// Simple person data for low risk cases
export interface PersonData {
country: string;
idNumber: string;
name: string;
dateOfBirth: string;
gender: string;
stateOfExistence: string;
role: string;
religiousAffiliation: string;
ethnicity: string;
}