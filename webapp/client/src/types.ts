/**
 * types.ts — client-side mirror of the API domain model.
 * Kept identical to server-node/src/types.ts (ARCHITECTURE.md §5).
 */

export type Role = 'owner' | 'moderator' | 'worker';

export type TaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  status: TaskStatus;
  assigneeId: string;
  workerId: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  reviewNote?: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  text?: string;
  audioUrl?: string;
  createdAt: number;
}

export interface Rating {
  id: string;
  raterId: string;
  rateeId: string;
  stars: number; // 1–5
  comment?: string;
  createdAt: number;
}
