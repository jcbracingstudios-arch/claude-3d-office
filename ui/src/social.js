// Who is chatting with whom on break, and who cheers a colleague who just finished a task.
// people: [{ s: session, target: { pos, kind }, mood, justDone }]
export function withSocial(people) {
  const idle = people.filter((p) => p.mood === 'idle');
  const near = (a, b) => Math.hypot(a.target.pos[0] - b.target.pos[0], a.target.pos[2] - b.target.pos[2]) < 2.2;
  return people.map((p) => {
    if (p.mood !== 'idle') return { ...p, social: null };
    const others = idle.filter((o) => o !== p && near(o, p));
    const partner = others[0];
    return {
      ...p,
      social: {
        partner: partner ? [partner.target.pos[0], partner.target.pos[2]] : null,
        first: partner ? p.s.id < partner.s.id : true, // who speaks first in the pair
        cheer: p.justDone ? 'self' : others.some((o) => o.justDone) ? 'clap' : null,
        kind: p.target.kind,
      },
    };
  });
}
