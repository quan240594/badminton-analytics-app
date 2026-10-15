import { Fragment } from 'react';

// A player's name, linking to their Badminton Nederland page. Every player has a url: their
// profile once it is known, otherwise the site's search on their MemberID or their tournament page.
export default function PlayerLink({ name, url }) {
  if (!url) return name;
  return (
    <a className="profile-link" href={url} target="_blank" rel="noopener noreferrer" title="Open on Badminton Nederland">
      {name}
    </a>
  );
}

// The members of a side ("A / B"), each linked on their own.
export function SideNames({ members }) {
  return members.map((member, index) => (
    <Fragment key={member.id}>
      {index > 0 && ' / '}
      <PlayerLink name={member.name} url={member.url} />
    </Fragment>
  ));
}
