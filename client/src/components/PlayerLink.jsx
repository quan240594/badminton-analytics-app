import { Fragment } from 'react';
import { profileUrl } from '../lib/profile.js';

// A player's name, linking to their Badminton Nederland profile when it is known.
export default function PlayerLink({ name, profile }) {
  if (!profile?.guid) return name;
  return (
    <a className="profile-link" href={profileUrl(profile.guid)} target="_blank" rel="noopener noreferrer" title="Open profile on Badminton Nederland">
      {name}
    </a>
  );
}

// The members of a side ("A / B"), each linked on their own.
export function SideNames({ members }) {
  return members.map((member, index) => (
    <Fragment key={member.id}>
      {index > 0 && ' / '}
      <PlayerLink name={member.name} profile={member.profile} />
    </Fragment>
  ));
}
