export declare const SECURITY_HEADERS: Record<string, string>;
export interface VercelRoute { src?: string; dest?: string; handle?: string; continue?: boolean; headers?: Record<string, string> }
export declare function vercelConfig(): { version: 3; routes: VercelRoute[]; crons: { path: string; schedule: string }[] };
