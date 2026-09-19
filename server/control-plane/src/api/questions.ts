import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { fetchAllPages } from "./paginate.js";

interface QuestionData {
  QuestionId: number;
  Name: string | null;
  QuestionText: RichText | null;
  Points: number;
  QuestionTypeId: number;
}

export interface Question {
  questionId: number;
  name: string | null;
  questionText: string | null;
  points: number;
  questionTypeId: number;
}

// D2L documents the survey question structure as identical to the quiz one, so both tools share
// this mapping.
export async function fetchQuestions(school: D2LSchool, path: string, cookieHeader: string): Promise<Question[]> {
  const raw = await fetchAllPages<QuestionData>(school, path, cookieHeader);
  return raw.map((q) => ({
    questionId: q.QuestionId,
    name: q.Name,
    questionText: q.QuestionText?.Text ?? null,
    points: q.Points,
    questionTypeId: q.QuestionTypeId,
  }));
}
