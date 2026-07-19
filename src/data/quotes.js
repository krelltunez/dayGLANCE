// Bundled daily quotes, replacing the previous runtime fetch to dummyjson.com so
// the quote works offline and adds no third-party dependency. A quote is chosen
// deterministically from the day of the year, so every device shows the same quote
// on the same date and it rotates once per day.

export const quotes = [
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Do the hard jobs first. The easy jobs will take care of themselves.', author: 'Dale Carnegie' },
  { text: 'You do not have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'Amateurs sit and wait for inspiration, the rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { text: 'Either you run the day or the day runs you.', author: 'Jim Rohn' },
  { text: 'Motivation is what gets you started. Habit is what keeps you going.', author: 'Jim Ryun' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
  { text: 'A goal without a plan is just a wish.', author: 'Antoine de Saint-Exupery' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'Success is the sum of small efforts repeated day in and day out.', author: 'Robert Collier' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  { text: 'You miss one hundred percent of the shots you do not take.', author: 'Wayne Gretzky' },
  { text: 'Great things are not done by impulse, but by a series of small things brought together.', author: 'Vincent van Gogh' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Do not watch the clock. Do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'Everything you have ever wanted is on the other side of fear.', author: 'George Addair' },
  { text: 'Whether you think you can or you think you cannot, you are right.', author: 'Henry Ford' },
  { text: 'The journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'What we fear doing most is usually what we most need to do.', author: 'Tim Ferriss' },
  { text: 'Ordinary people think merely of spending time. Great people think of using it.', author: 'Arthur Schopenhauer' },
  { text: 'You will never find time for anything. If you want time, you must make it.', author: 'Charles Buxton' },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin' },
  { text: 'Concentrate all your thoughts upon the work at hand.', author: 'Alexander Graham Bell' },
  { text: 'Nothing is particularly hard if you divide it into small jobs.', author: 'Henry Ford' },
  { text: 'The secret of your future is hidden in your daily routine.', author: 'Mike Murdock' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
  { text: 'If you spend too long thinking about a thing, you will never get it done.', author: 'Bruce Lee' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { text: 'Productivity is never an accident. It is always the result of a commitment to excellence.', author: 'Paul J. Meyer' },
  { text: 'It is not enough to be busy. The question is, what are we busy about?', author: 'Henry David Thoreau' },
  { text: 'Once you have commitment, you need the discipline and hard work to get you there.', author: 'Haile Gebrselassie' },
  { text: 'Setting goals is the first step in turning the invisible into the visible.', author: 'Tony Robbins' },
  { text: 'You cannot build a reputation on what you are going to do.', author: 'Henry Ford' },
  { text: 'The most effective way to do it is to do it.', author: 'Amelia Earhart' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act but a habit.', author: 'Will Durant' },
  { text: 'Take care of the minutes and the hours will take care of themselves.', author: 'Lord Chesterfield' },
  { text: 'Never confuse motion with action.', author: 'Benjamin Franklin' },
  { text: 'Doing something imperfectly is better than doing nothing perfectly.', author: 'Robert Schuller' },
  { text: 'Your future is created by what you do today, not tomorrow.', author: 'Robert Kiyosaki' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
  { text: 'The bad news is time flies. The good news is you are the pilot.', author: 'Michael Altshuler' },
  { text: 'Do not count the days, make the days count.', author: 'Muhammad Ali' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'The key is not to prioritize what is on your schedule, but to schedule your priorities.', author: 'Stephen Covey' },
  { text: 'Absorb what is useful, discard what is useless, and add what is specifically your own.', author: 'Bruce Lee' },
  { text: 'The best preparation for tomorrow is doing your best today.', author: 'H. Jackson Brown Jr.' },
  { text: 'Perseverance is not a long race. It is many short races one after the other.', author: 'Walter Elliot' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', author: 'James Clear' },
  { text: 'Every accomplishment starts with the decision to try.', author: 'Gail Devers' },
  { text: 'Work gives you meaning and purpose, and life is empty without it.', author: 'Stephen Hawking' },
  { text: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt' },
  { text: 'The habit of persistence is the habit of victory.', author: 'Herbert Kaufman' },
  { text: 'Slow progress is still progress.', author: 'Anonymous' },
  { text: 'One day or day one. You decide.', author: 'Anonymous' },
];

// Days elapsed since the start of the year (0-based), computed in local time so the
// quote flips over at the user's local midnight.
const dayOfYear = (date) => {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
};

// Deterministically pick the quote for a given date: same date -> same quote on
// every device. Rotates once per day and wraps with modulo over the list length.
export const getDailyQuote = (date = new Date()) => {
  const index = ((dayOfYear(date) % quotes.length) + quotes.length) % quotes.length;
  return quotes[index];
};
