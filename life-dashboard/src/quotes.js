export const QUOTES = [
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Small deeds done are better than great deeds planned.', 'Peter Marshall'],
  ['You do not rise to the level of your goals. You fall to the level of your systems.', 'James Clear'],
  ['Discipline is choosing between what you want now and what you want most.', 'Abraham Lincoln (attr.)'],
  ['What you do every day matters more than what you do once in a while.', 'Gretchen Rubin'],
  ['Focus on being productive instead of busy.', 'Tim Ferriss'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
  ['Amateurs sit and wait for inspiration, the rest of us just get up and go to work.', 'Stephen King'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Don\'t count the days, make the days count.', 'Muhammad Ali'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
  ['Be not afraid of going slowly; be afraid only of standing still.', 'Chinese proverb'],
  ['Whoever is patient will attain what they hope for.', 'Arabic proverb'],
  ['He who knows himself is enlightened.', 'Lao Tzu'],
  ['Take care of your body. It\'s the only place you have to live.', 'Jim Rohn'],
  ['Motivation gets you going, but habit gets you there.', 'Zig Ziglar'],
  ['Do the hard jobs first. The easy jobs will take care of themselves.', 'Dale Carnegie'],
  ['The future depends on what you do today.', 'Mahatma Gandhi'],
  ['A year from now you may wish you had started today.', 'Karen Lamb'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
  ['Either you run the day or the day runs you.', 'Jim Rohn'],
  ['What we fear doing most is usually what we most need to do.', 'Tim Ferriss'],
  ['The man who moves a mountain begins by carrying away small stones.', 'Confucius'],
  ['Knowing is not enough; we must apply.', 'Johann Wolfgang von Goethe'],
  ['Dream big. Start small. Act now.', 'Robin Sharma'],
  ['Great things are done by a series of small things brought together.', 'Vincent van Gogh'],
  ['Your mind is for having ideas, not holding them.', 'David Allen'],
  ['Rest is not idleness.', 'John Lubbock'],
  ['Done is better than perfect.', 'Sheryl Sandberg'],
];

export function quoteFor(date) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [text, author] = QUOTES[h % QUOTES.length];
  return { text, author };
}
