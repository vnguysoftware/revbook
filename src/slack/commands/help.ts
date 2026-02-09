import type { Database } from '../../config/database.js';
import type { SlackMessage } from '../types.js';
import { formatHelp } from '../formatters.js';

export async function handleHelp(_db: Database, _args: string): Promise<SlackMessage> {
  return formatHelp();
}
