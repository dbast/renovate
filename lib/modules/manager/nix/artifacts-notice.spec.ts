import { getFlakeLockNotice } from './artifacts-notice.ts';

const oldRev = '95ca1e203c0750115fd4a6f17d5a245dfe6b1edd';
const newRev = '7993f34ee47e28a3d607a525aadc6c94b73be728';
const oldDate = 1704067200; // 2024-01-01T00:00:00Z
const newDate = 1706745600; // 2024-02-01T00:00:00Z

function lock(nodes: Record<string, unknown>): string {
  return JSON.stringify({ nodes, version: 7 });
}

function githubNode(
  rev: string,
  lastModified: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    locked: {
      type: 'github',
      owner: 'NixOS',
      repo: 'nixpkgs',
      rev,
      lastModified,
      ...extra,
    },
  };
}

describe('modules/manager/nix/artifacts-notice', () => {
  it('returns null when nothing changed', () => {
    const content = lock({
      root: {},
      nixpkgs: githubNode(oldRev, oldDate),
    });

    expect(getFlakeLockNotice(content, content, 'flake.lock')).toBeNull();
  });

  it('returns null for unparseable lock files', () => {
    expect(getFlakeLockNotice('not json', '[]', 'flake.lock')).toBeNull();
    expect(
      getFlakeLockNotice(lock({}), 'not json either', 'flake.lock'),
    ).toBeNull();
  });

  it('ignores narHash-only changes', () => {
    const before = lock({
      nixpkgs: githubNode(oldRev, oldDate, { narHash: 'sha256-aaa' }),
    });
    const after = lock({
      nixpkgs: githubNode(oldRev, oldDate, { narHash: 'sha256-bbb' }),
    });

    expect(getFlakeLockNotice(before, after, 'flake.lock')).toBeNull();
  });

  it('summarizes a github input change', () => {
    const before = lock({ nixpkgs: githubNode(oldRev, oldDate) });
    const after = lock({ nixpkgs: githubNode(newRev, newDate) });

    expect(getFlakeLockNotice(before, after, 'flake.lock')).toEqual({
      file: 'flake.lock',
      message: [
        'The lock file update changed the following flake inputs:',
        '',
        '| Input | Old | New | Diff |',
        '| --- | --- | --- | --- |',
        `| nixpkgs | \`95ca1e2\` 2024-01-01T00:00Z | \`7993f34\` 2024-02-01T00:00Z | [compare](https://github.com/NixOS/nixpkgs/compare/${oldRev}..${newRev}) |`,
      ].join('\n'),
    });
  });

  it('uses the host field for github enterprise inputs', () => {
    const before = lock({
      nixpkgs: githubNode(oldRev, oldDate, { host: 'ghe.example.com' }),
    });
    const after = lock({
      nixpkgs: githubNode(newRev, newDate, { host: 'ghe.example.com' }),
    });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      `https://ghe.example.com/NixOS/nixpkgs/compare/${oldRev}..${newRev}`,
    );
  });

  it('links gitlab inputs to the gitlab compare view', () => {
    function gitlabNode(
      rev: string,
      lastModified: number,
    ): Record<string, unknown> {
      return {
        locked: {
          type: 'gitlab',
          host: 'gitlab.example.com',
          owner: 'group%2Fsubgroup',
          repo: 'project',
          rev,
          lastModified,
        },
      };
    }
    const before = lock({ infra: gitlabNode(oldRev, oldDate) });
    const after = lock({ infra: gitlabNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      `https://gitlab.example.com/group/subgroup/project/-/compare/${oldRev}...${newRev}`,
    );
  });

  it('defaults to gitlab.com for gitlab inputs without host', () => {
    function gitlabNode(
      rev: string,
      lastModified: number,
    ): Record<string, unknown> {
      return {
        locked: {
          type: 'gitlab',
          owner: 'group',
          repo: 'project',
          rev,
          lastModified,
        },
      };
    }
    const before = lock({ infra: gitlabNode(oldRev, oldDate) });
    const after = lock({ infra: gitlabNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      `https://gitlab.com/group/project/-/compare/${oldRev}...${newRev}`,
    );
  });

  it.each([
    ['group/subgroup/nested', 'group/subgroup/nested'],
    ['group%2fsubgroup%2Fnested', 'group/subgroup/nested'],
    ['group%23name%2Fsubgroup', 'group%23name/subgroup'],
    ['group%invalid%2Fsubgroup', 'group%invalid/subgroup'],
  ])('normalizes only GitLab namespace separators in %s', (owner, path) => {
    function content(rev: string): string {
      return lock({
        dep: {
          locked: { type: 'gitlab', owner, repo: 'project', rev },
        },
      });
    }

    expect(
      getFlakeLockNotice(content(oldRev), content(newRev), 'flake.lock')
        ?.message,
    ).toContain(
      `https://gitlab.com/${path}/project/-/compare/${oldRev}...${newRev}`,
    );
  });

  it.each(['github', 'gitlab'] as const)(
    'has no diff link for %s inputs without owner or repo',
    (type) => {
      function node(
        rev: string,
        lastModified: number,
      ): Record<string, unknown> {
        return { locked: { type, rev, lastModified } };
      }
      const before = lock({ dep: node(oldRev, oldDate) });
      const after = lock({ dep: node(newRev, newDate) });

      const notice = getFlakeLockNotice(before, after, 'flake.lock');
      expect(notice?.message).toContain(
        '| dep | `95ca1e2` 2024-01-01T00:00Z | `7993f34` 2024-02-01T00:00Z | - |',
      );
    },
  );

  it('has no diff link for git inputs without url', () => {
    function node(rev: string, lastModified: number): Record<string, unknown> {
      return { locked: { type: 'git', rev, lastModified } };
    }
    const before = lock({ dep: node(oldRev, oldDate) });
    const after = lock({ dep: node(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      '| dep | `95ca1e2` 2024-01-01T00:00Z | `7993f34` 2024-02-01T00:00Z | - |',
    );
  });

  it('omits out-of-range lastModified dates', () => {
    const before = lock({ nixpkgs: githubNode(oldRev, oldDate) });
    const after = lock({ nixpkgs: githubNode(newRev, 1e15) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      '| nixpkgs | `95ca1e2` 2024-01-01T00:00Z | `7993f34` | [compare]',
    );
  });

  it.each([
    ['https://codeberg.org/some-org/some-repo', null],
    ['https://codeberg.org/some-org/some-repo.git', null],
    ['https://gitea.example.com/some-org/some-repo', null],
    ['https://github.com/some-org/some-repo', null],
  ])('links generic git input %s to its forge compare view', (url) => {
    function gitNode(
      rev: string,
      lastModified: number,
    ): Record<string, unknown> {
      return { locked: { type: 'git', url, rev, lastModified } };
    }
    const before = lock({ dep: gitNode(oldRev, oldDate) });
    const after = lock({ dep: gitNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    const baseUrl = url.replace(/\.git$/, '');
    expect(notice?.message).toContain(
      `[compare](${baseUrl}/compare/${oldRev}..${newRev})`,
    );
  });

  it.each([
    [
      'https://codeberg.org/org/repo.git/',
      'https://codeberg.org/org/repo',
      '..',
    ],
    [
      'https://codeberg.org/org/repo%23name.git',
      'https://codeberg.org/org/repo%23name',
      '..',
    ],
    [
      'https://user:password@codeberg.org/org/repo.git?token=secret#fragment',
      'https://codeberg.org/org/repo',
      '..',
    ],
    [
      'https://gitlab.com/group/subgroup/repo.git',
      'https://gitlab.com/group/subgroup/repo/-',
      '...',
    ],
  ])(
    'preserves URL path encoding and strips clone-only fields in %s',
    (url, base, dots) => {
      function content(rev: string): string {
        return lock({ dep: { locked: { type: 'git', url, rev } } });
      }

      expect(
        getFlakeLockNotice(content(oldRev), content(newRev), 'flake.lock')
          ?.message,
      ).toContain(`[compare](${base}/compare/${oldRev}${dots}${newRev})`);
    },
  );

  it.each([
    'https://unknown.example.com/some-org/some-repo',
    'ssh://git@codeberg.org/some-org/some-repo.git',
    'git@github.com:some-org/some-repo.git',
  ])('has no diff link for unrecognized git host %s', (url) => {
    function gitNode(
      rev: string,
      lastModified: number,
    ): Record<string, unknown> {
      return { locked: { type: 'git', url, rev, lastModified } };
    }
    const before = lock({ dep: gitNode(oldRev, oldDate) });
    const after = lock({ dep: gitNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain('| - |');
    expect(notice?.message).not.toContain('compare]');
  });

  it('shows rev changes for input types without compare view', () => {
    function sourcehutNode(
      rev: string,
      lastModified: number,
    ): Record<string, unknown> {
      return {
        locked: {
          type: 'sourcehut',
          owner: '~user',
          repo: 'repo',
          rev,
          lastModified,
        },
      };
    }
    const before = lock({ dep: sourcehutNode(oldRev, oldDate) });
    const after = lock({ dep: sourcehutNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      '| dep | `95ca1e2` 2024-01-01T00:00Z | `7993f34` 2024-02-01T00:00Z | - |',
    );
  });

  it('marks added and removed inputs', () => {
    const before = lock({ removed: githubNode(oldRev, oldDate) });
    const after = lock({ added: githubNode(newRev, newDate) });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain(
      `| added | - | \`7993f34\` 2024-02-01T00:00Z | - |`,
    );
    expect(notice?.message).toContain(
      `| removed | \`95ca1e2\` 2024-01-01T00:00Z | - | - |`,
    );
  });

  it('shows the change without diff link when the repository moved', () => {
    const before = lock({ nixpkgs: githubNode(oldRev, oldDate) });
    const after = lock({
      nixpkgs: githubNode(newRev, newDate, { owner: 'some-fork' }),
    });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain('| nixpkgs |');
    expect(notice?.message).toContain('| - |');
    expect(notice?.message).not.toContain('compare]');
  });

  it('shows inputs without rev or date as dash', () => {
    const before = lock({});
    const after = lock({
      tarball: {
        locked: { type: 'tarball', url: 'https://example.com/a.tgz' },
      },
    });

    const notice = getFlakeLockNotice(before, after, 'flake.lock');
    expect(notice?.message).toContain('| tarball | - | - | - |');
  });

  it('ignores tarball url-only churn when rev is unchanged', () => {
    // tarball inputs have no rev; a refetch changes only narHash and lastModified
    const before = lock({
      tarball: {
        locked: {
          type: 'tarball',
          url: 'https://example.com/a.tgz',
          narHash: 'sha256-aaa',
        },
      },
    });
    const after = lock({
      tarball: {
        locked: {
          type: 'tarball',
          url: 'https://example.com/a.tgz',
          narHash: 'sha256-bbb',
        },
      },
    });

    expect(getFlakeLockNotice(before, after, 'flake.lock')).toBeNull();
  });

  it('sorts rows by input name and escapes pipes', () => {
    const before = lock({
      'b|input': githubNode(oldRev, oldDate),
      'a-input': githubNode(oldRev, oldDate),
    });
    const after = lock({
      'b|input': githubNode(newRev, newDate),
      'a-input': githubNode(newRev, newDate),
    });

    const message = getFlakeLockNotice(before, after, 'flake.lock')?.message;
    const aIndex = message?.indexOf('| a-input |');
    const bIndex = message?.indexOf('| b\\|input |');
    expect(aIndex).toBeGreaterThan(-1);
    expect(bIndex).toBeGreaterThan(-1);
    expect(aIndex).toBeLessThan(bIndex!);
  });
});
