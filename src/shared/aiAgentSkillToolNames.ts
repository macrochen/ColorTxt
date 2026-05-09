/** OpenAI function name：字母数字与 _ - */
export function sanitizeAgentSkillToolName(id: string): string {
  const s = id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return s.length > 0 ? s : "skill";
}

/** 与 ragSearch/ragContext/getSkills 隔离的技能工具名 */
export function agentSkillToolFunctionName(id: string): string {
  return `skill_${sanitizeAgentSkillToolName(id)}`;
}
