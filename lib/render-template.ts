// Tiny, safe {{variable}} substitution for email templates. No eval, no deps.

export interface TemplateVars {
    first_name?: string;
    name?: string;
    position?: string;
    company?: string;
    [key: string]: string | undefined;
}

/** Replaces {{key}} (any surrounding whitespace) with the matching value. */
export function renderTemplate(text: string, vars: TemplateVars): string {
    return (text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
        const v = vars[key];
        return v != null ? String(v) : '';
    });
}

/** The variables recruiters can use in templates (for UI hints). */
export const TEMPLATE_VARS = ['first_name', 'name', 'position', 'company'] as const;
