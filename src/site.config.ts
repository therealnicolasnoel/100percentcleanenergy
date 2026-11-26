/** Where the site's source and reports live on GitHub. */
const repo = import.meta.env.PUBLIC_GITHUB_REPO || 'therealnicolasnoel/100percentcleanenergy';
const branch = import.meta.env.PUBLIC_GITHUB_BRANCH || 'main';

export const site = {
  name: 'Keystone reports',
  description: 'The world’s 100 hardest problems, broken down into sub-goals, steps and the projects moving them, with who is working on each and a forecast of where it leads. Everything lives in GitHub and every change is a commit.',
  repo,
  branch,
  repoUrl: `https://github.com/${repo}`,
};

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix an internal path with the deploy base path. */
export function url(path = '/'): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Links into the GitHub repo for a file path relative to the repo root. */
export const gh = {
  blob: (path: string) => `${site.repoUrl}/blob/${branch}/${path}`,
  edit: (path: string) => `${site.repoUrl}/edit/${branch}/${path}`,
  history: (path: string) => `${site.repoUrl}/commits/${branch}/${path}`,
  tree: (path: string) => `${site.repoUrl}/tree/${branch}/${path}`,
  /** Open GitHub's "new file" editor with a filename and starting content. */
  newFile: (path: string, value: string) =>
    `${site.repoUrl}/new/${branch}?filename=${encodeURIComponent(path)}&value=${encodeURIComponent(value)}`,
  issues: (title: string, body: string) =>
    `${site.repoUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`,
};

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
