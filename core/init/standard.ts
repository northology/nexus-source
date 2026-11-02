/** The registry files init copies from standard/ into docs/_meta/. standard/ also holds init's other templates. */
export const REGISTRY_ENTRIES = ['classes', 'tags.md', 'components.md', 'contract.md'] as const;

/** Stands for the repo's folder name in shipped settings (Hearth's title); init replaces it. */
export const REPO_NAME_TOKEN = '__REPO_NAME__';
