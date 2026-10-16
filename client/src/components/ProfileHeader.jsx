import { displayName } from '../lib/profiles.js';

// The band at the top of a toernooi player profile: the name large, the MemberID beside it.
export default function ProfileHeader({ name, memberId, country }) {
  return (
    <header className="tn-head">
      <h2 className="tn-head__name">{displayName(name)}</h2>
      {memberId && <span className="tn-head__aside">({memberId})</span>}
      {country && <span className="tn-head__country">{country}</span>}
    </header>
  );
}
