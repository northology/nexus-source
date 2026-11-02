import { readFileSync } from 'node:fs';
import { NexusError } from '../errors.ts';
import { validate } from '../schemas.ts';

export interface InitAnswers {
  answers: 1;
  components: string[];
  tags: string[];
  seeding: { what: string; where: string }[];
}

export const EMPTY_ANSWERS: InitAnswers = { answers: 1, components: [], tags: [], seeding: [] };

export function parseAnswers(data: unknown): InitAnswers {
  const problems = validate('init-answers', data);
  if (problems.length) throw new NexusError(`The answers file is invalid: ${problems.join('; ')}`);
  return data as InitAnswers;
}

export function readAnswers(file: string): InitAnswers {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new NexusError(`Could not read the answers file ${file}: ${(e as Error).message}`);
  }
  return parseAnswers(data);
}

/** The answers as init writes them to .nexus/init-answers.json. */
export function answersText(a: InitAnswers): string {
  return `${JSON.stringify({ answers: a.answers, components: a.components, tags: a.tags, seeding: a.seeding }, null, 2)}\n`;
}
