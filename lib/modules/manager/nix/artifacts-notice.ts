import { isNullOrUndefined } from '@sindresorhus/is';
import { DateTime } from 'luxon';
import type { PlatformFamilyId } from '../../../constants/index.ts';
import { logger } from '../../../logger/index.ts';
import { detectPlatform } from '../../../util/common.ts';
import { regEx } from '../../../util/regex.ts';
import { parseUrl } from '../../../util/url.ts';
import type { ArtifactNotice } from '../types.ts';
import { NixFlakeLock } from './schema.ts';

type LockedInput = NonNullable<NixFlakeLock['nodes'][string]['locked']>;

/**
 * Compare URL path per platform family, matching the `changelogUrl` templates
 * of the `helpers:*DigestChangelogs` presets. Families which share the GitHub
 * web UI layout (forgejo, gitea) use the same path.
 */
const compareUrlPaths: Partial<
  Record<PlatformFamilyId, (from: string, to: string) => string>
> = {
  forgejo: (from, to) => `compare/${from}..${to}`,
  gitea: (from, to) => `compare/${from}..${to}`,
  github: (from, to) => `compare/${from}..${to}`,
  gitlab: (from, to) => `-/compare/${from}...${to}`,
};

/**
 * Web URL of the repository a locked input was fetched from, or null when the
 * input type carries no browsable repository (path, tarball, indirect, ...).
 */
function repoUrl(locked: LockedInput | undefined): string | null {
  switch (locked?.type) {
    case 'github':
      return locked.owner && locked.repo
        ? `https://${locked.host ?? 'github.com'}/${locked.owner}/${locked.repo}`
        : null;
    case 'gitlab':
      return locked.owner && locked.repo
        ? `https://${locked.host ?? 'gitlab.com'}/${locked.owner.replace(regEx(/%2f/gi), '/')}/${locked.repo}`
        : null;
    case 'git': {
      const parsed = locked.url ? parseUrl(locked.url) : null;
      if (
        !parsed ||
        (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      ) {
        return null;
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(regEx(/\/$/), '').replace(regEx(/\.git$/), '')}`;
    }
    // All other input types (sourcehut, tarball, path, ...) have no
    // browsable repository URL with a known compare view.
    default:
      return null;
  }
}

/**
 * Compare URL for the rev change between two locked inputs, or null when the
 * input moved to a different repository or the hosting platform has no known
 * compare URL layout.
 */
function compareUrl(
  before: LockedInput | undefined,
  after: LockedInput | undefined,
): string | null {
  if (!before?.rev || !after?.rev) {
    return null;
  }
  const baseUrl = repoUrl(before);
  if (!baseUrl || repoUrl(after) !== baseUrl) {
    return null;
  }
  // The input type identifies github/gitlab inputs, including self-hosted
  // instances via the host field; detectPlatform extends this to forgejo,
  // gitea and other families for generic git inputs.
  let family: PlatformFamilyId | null;
  if (before.type === 'github') {
    family = 'github';
  } else if (before.type === 'gitlab') {
    family = 'gitlab';
  } else {
    family = detectPlatform(baseUrl);
  }
  const path = family ? compareUrlPaths[family] : null;
  return path ? `${baseUrl}/${path(before.rev, after.rev)}` : null;
}

function formatDate(timestamp: number | undefined): string | null {
  if (isNullOrUndefined(timestamp)) {
    return null;
  }
  // ISO 8601 in UTC, e.g. 2024-01-01T00:00Z; Renovate renders absolute dates
  // in UTC everywhere (the `timezone` option only affects schedules).
  const dateTime = DateTime.fromSeconds(timestamp, { zone: 'utc' });
  return dateTime.isValid
    ? dateTime.toISO({ suppressSeconds: true, suppressMilliseconds: true })
    : null;
}

function formatLocked(locked: LockedInput | undefined): string {
  if (!locked) {
    return '-';
  }
  const parts: string[] = [];
  if (locked.rev) {
    parts.push(`\`${locked.rev.slice(0, 7)}\``);
  }
  const date = formatDate(locked.lastModified);
  if (date) {
    parts.push(date);
  }
  return parts.length ? parts.join(' ') : '-';
}

/**
 * A rev or url change is what matters to reviewers; narHash-only changes come
 * from refetching the identical content and are noise.
 */
function hasChanged(
  before: LockedInput | undefined,
  after: LockedInput | undefined,
): boolean {
  if (!before || !after) {
    return before !== after;
  }
  return (
    before.type !== after.type ||
    before.rev !== after.rev ||
    before.url !== after.url
  );
}

/**
 * Summarizes the flake input changes of a lock file update as a markdown
 * table, to be posted as artifact notice on the update's PR. Returns null
 * when nothing relevant changed or either lock file version fails to parse.
 */
export function getFlakeLockNotice(
  existingLockFileContent: string,
  newLockFileContent: string,
  lockFileName: string,
): ArtifactNotice | null {
  const before = NixFlakeLock.safeParse(existingLockFileContent);
  const after = NixFlakeLock.safeParse(newLockFileContent);
  if (!before.success || !after.success) {
    logger.debug(
      { lockFileName },
      'Skipping flake.lock change notice: could not parse lock file',
    );
    return null;
  }

  const names = [
    ...new Set([
      ...Object.keys(before.data.nodes),
      ...Object.keys(after.data.nodes),
    ]),
  ].sort();
  const rows: string[] = [];
  for (const name of names) {
    const beforeLocked = before.data.nodes[name]?.locked;
    const afterLocked = after.data.nodes[name]?.locked;
    if (!hasChanged(beforeLocked, afterLocked)) {
      continue;
    }
    const diff = compareUrl(beforeLocked, afterLocked);
    rows.push(
      `| ${name.replaceAll('|', '\\|')} | ${formatLocked(beforeLocked)} | ${formatLocked(afterLocked)} | ${diff ? `[compare](${diff})` : '-'} |`,
    );
  }
  if (!rows.length) {
    return null;
  }

  return {
    file: lockFileName,
    message: [
      'The lock file update changed the following flake inputs:',
      '',
      '| Input | Old | New | Diff |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
  };
}
