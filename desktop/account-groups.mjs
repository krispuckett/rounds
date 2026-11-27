// Group only provider-confirmed identities. Unknown profiles remain distinct.
export function groupAccounts(provider, identityFor = () => null) {
  const groups = new Map();
  for (const profile of provider.profiles) {
    const identity = identityFor(profile.id) || {};
    const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
    const org = typeof identity.organization === "string" ? identity.organization.trim().toLowerCase() : "";
    const key = email ? "verified:" + email + ":" + org : profile.id;
    if (!groups.has(key)) groups.set(key, { key, verified: !!email, identity, profiles: [] });
    groups.get(key).profiles.push(profile);
  }
  return [...groups.values()].map(group => {
    const primary = group.profiles.find(x => x.enabled) || group.profiles.find(x => x.label !== x.defaultLabel) || group.profiles[0];
    return { ...group, primary, label: primary.label, enabled: group.profiles.some(x => x.enabled) };
  });
}
