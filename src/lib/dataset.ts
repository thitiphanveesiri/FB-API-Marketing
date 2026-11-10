import type { Ad, Agency, Campaign, DailyPerf, Evaluation, FbPage, ImportRecord, Lead, Message, PageInsight, PostComment, User } from "./types";

export interface Dataset {
  users: User[];
  pages: FbPage[];
  agencies: Agency[];
  campaigns: Campaign[];
  ads: Ad[];
  perf: DailyPerf[];
  leads: Lead[];
  messages: Record<string, Message[]>;
  evaluations: Evaluation[];
  imports: ImportRecord[];
  insights: PageInsight[];
  comments: PostComment[];
}
export const emptyDataset = (): Dataset => ({ users: [], pages: [], agencies: [], campaigns: [], ads: [], perf: [], leads: [], messages: {}, evaluations: [], imports: [], insights: [], comments: [] });
