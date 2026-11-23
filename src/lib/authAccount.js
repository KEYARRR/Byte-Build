const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export function isAuthorizedAdminEmail(email, adminEmails = []) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return (Array.isArray(adminEmails) ? adminEmails : []).some(
    (entry) => normalizeEmail(entry) === target
  );
}

export function isRecoveryHash(hash = '') {
  const str = String(hash || '');
  return Boolean(str && (str.includes('type=recovery') || str.includes('access_token')));
}

export function formatAccountScoreLabel(score) {
  if (score === null || score === undefined) {
    return 'Not enough data';
  }
  return `${score}%`;
}

export function formatAccountDisplayName(user) {
  if (!user || !user.email) return 'Sign In';
  const handle = String(user.email).split('@')[0];
  return handle || 'Account';
}