import { useState } from 'react';

const useDailyContent = () => {
  const [dailyContent, setDailyContent] = useState({
    dadJoke: null,
    funFact: null,
    quote: null,
    history: null
  });
  const [contentRotation, setContentRotation] = useState(0);

  const fetchAllDailyContent = async () => {
    const today = new Date().toDateString();
    const cached = localStorage.getItem('dailyContent');

    if (cached) {
      const { content, date } = JSON.parse(cached);
      if (date === today) {
        setDailyContent(content);
        return;
      }
    }

    const content = { dadJoke: null, funFact: null, quote: null, history: null };
    const decodeHTML = (str) => {
      if (!str) return str;
      const doc = new DOMParser().parseFromString(str, 'text/html');
      return (doc.body.textContent || '').replace(/`/g, "'");
    };

    // Fetch dad joke
    try {
      const response = await fetch('https://icanhazdadjoke.com/', {
        headers: { 'Accept': 'application/json' }
      });
      const data = await response.json();
      if (data.joke) content.dadJoke = decodeHTML(data.joke);
    } catch (error) {
      console.error('Failed to fetch dad joke:', error);
    }

    // Fetch fun fact
    try {
      const response = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
      const data = await response.json();
      if (data.text) content.funFact = decodeHTML(data.text);
    } catch (error) {
      console.error('Failed to fetch fun fact:', error);
    }

    // Fetch quote
    try {
      const response = await fetch('https://dummyjson.com/quotes/random');
      const data = await response.json();
      if (data.quote) content.quote = { text: decodeHTML(data.quote), author: decodeHTML(data.author) };
    } catch (error) {
      console.error('Failed to fetch quote:', error);
    }

    // Fetch this day in history
    try {
      const now = new Date();
      const response = await fetch(`https://history.muffinlabs.com/date/${now.getMonth() + 1}/${now.getDate()}`);
      const data = await response.json();
      if (data.data?.Events?.length > 0) {
        const randomEvent = data.data.Events[Math.floor(Math.random() * data.data.Events.length)];
        content.history = { year: randomEvent.year, text: decodeHTML(randomEvent.text) };
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }

    setDailyContent(content);
    localStorage.setItem('dailyContent', JSON.stringify({ content, date: today }));
  };

  return {
    dailyContent, setDailyContent,
    contentRotation, setContentRotation,
    fetchAllDailyContent,
  };
};

export default useDailyContent;
