import { BookOpen } from 'lucide-react';

const guides: Record<
  string,
  {
    title: string;
    purpose: string;
    steps: [string, string][];
    example: string;
    terms: [string, string][];
  }
> = {
  sessions: {
    title: 'Sessions',
    purpose:
      'A session is one saved replay: its market data, paper account, orders and chart settings. Use this tab to keep your progress and continue later.',
    steps: [
      [
        'Save your current replay',
        'Enter a Session name and select Save as new session. After that, changes to this saved replay save automatically.',
      ],
      [
        'Continue where you stopped',
        'Find the session in Active and select Resume. Open this same server on another device to use the same library.',
      ],
      [
        'Organize or move your work',
        'Use the three-dot menu beside Resume to rename, duplicate, archive or export. Open Import & browser storage to bring in a session ZIP.',
      ],
    ],
    example:
      'Name a session “AAPL pullback practice”. After a few trades, close the app. Return to Sessions and select Resume beside that name to continue with the same account.',
    terms: [
      [
        'Browser workspace',
        'Unsaved work stays in this browser and at this web address. Save it to the server library before switching devices.',
      ],
      [
        'Archive vs delete',
        'Archive keeps a session in the Archived list; Unarchive brings it back. Delete permanently removes the session and its journal.',
      ],
      [
        'Take control',
        'Only one device can trade a saved session at a time. Use this action to transfer control from another device.',
      ],
      [
        'Export ZIP',
        'A portable backup containing the session, journal notes and attached images. Import it on another Replay server.',
      ],
    ],
  },
  journal: {
    title: 'Trade journal',
    purpose:
      'This is your trading notebook. Record why you entered, why you exited and what you learned, so you can review decisions alongside results.',
    steps: [
      [
        'Save a session and place a trade',
        'First save your replay in Sessions, then return to the chart to buy or sell. Come back here to see the trade.',
      ],
      [
        'Write down your reasoning',
        'Expand the trade. Give it a setup name, add tags, and describe your entry, exit and lessons. Select Save notes to keep your edits.',
      ],
      [
        'Keep a visual record',
        'Select Capture chart to attach the chart as it looks now. Capture settings & export contains automatic capture and journal CSV export.',
      ],
    ],
    example:
      'Setup: “Pullback”. Tags: “trend, patient”. Entry: “Price held above the moving average”. After closing, note whether you followed your planned stop.',
    terms: [
      [
        'Setup',
        'A short name for the trading pattern or idea. Reuse names consistently to compare setups in Performance.',
      ],
      [
        'Tags',
        'Your own labels for finding and grouping trades, such as breakout, rushed or patient.',
      ],
      [
        'One journal trade',
        'A trade runs from opening a position until you are flat again. Partial exits belong to the same trade. Open positions can have notes too.',
      ],
      [
        'Chart capture',
        'An image of the current chart, not an automatic reconstruction of how it looked at entry. Capturing also saves the note draft you are editing.',
      ],
    ],
  },
  analytics: {
    title: 'Performance',
    purpose:
      'Review the results of completed trades in the current session. Use this tab to understand whether your decisions are working after trading costs.',
    steps: [
      [
        'Complete a paper trade',
        'Open and then fully close a position on the chart. An open position does not count as a completed trade here.',
      ],
      [
        'Read the headline results',
        'Start with Closed trades, Net P&L, Win rate and Profit factor. Expand More statistics & drawdown for deeper account statistics.',
      ],
      [
        'Look for patterns',
        'Filter by a setup, tag or direction. Use Group performance to compare categories, or export the closed trades as CSV.',
      ],
    ],
    example:
      'If five of ten trades made money, the win rate is 50%. If winners earned 300 and losers lost 200, the profit factor is 1.5. Win rate alone does not tell you whether the session was profitable.',
    terms: [
      [
        'Net P&L',
        'Total profit or loss on completed trades after fees. A positive number is a profit; a negative number is a loss.',
      ],
      [
        'Expectancy',
        'Average net profit or loss per completed trade. It is a description of this sample, not a prediction.',
      ],
      [
        'Drawdown',
        'How far account equity fell from a previous peak. Drawdown statistics cover the whole account even when you filter the trade list.',
      ],
      [
        'R multiple',
        'Trade profit or loss divided by its recorded planned risk. Earning 100 after risking 50 is +2R. A dash means no planned risk was recorded.',
      ],
      [
        'MAE / MFE',
        'Estimated worst move against the trade and best move in its favor, in price units, using candle highs and lows.',
      ],
      [
        'Dash or infinity',
        'A dash means there is not enough data for that measure. Profit factor is infinite when there are profits but no losing trades yet.',
      ],
    ],
  },
  blind: {
    title: 'Blind practice',
    purpose:
      'Practice making trading decisions without seeing calendar dates or what comes next. Replay chooses a random window from the loaded historical data.',
    steps: [
      [
        'Keep your current work first',
        'Save your current replay in Sessions if you want to return to it. Starting an exercise creates a fresh paper account.',
      ],
      [
        'Choose a length and start',
        'Try 25 candles for a short exercise, or enter your own whole number. Select Start blind exercise to return to the chart.',
      ],
      [
        'Trade, then review',
        'Play or step through the candles and place paper orders. Select Finish exercise to cancel pending orders, close any position and reveal dates and results.',
      ],
    ],
    example:
      'At a 5-minute interval, a 25-candle exercise contains 25 five-minute bars. Replay speed controls how quickly you reveal them; you do not have to wait five real minutes per candle.',
    terms: [
      [
        'Candle count',
        'The number of new bars in the exercise. More candles give you more decisions; the maximum depends on the loaded dataset.',
      ],
      [
        'What stays visible',
        'The ticker and revealed price history stay visible. Calendar dates and the surrounding dataset’s progress are hidden.',
      ],
      [
        'Finish early',
        'You can finish before the last candle. Any open position closes at the currently revealed candle’s close, with configured costs.',
      ],
    ],
  },
  strategies: {
    title: 'Strategy lab',
    purpose:
      'Turn trading ideas into rules and test them automatically on the loaded historical data. A backtest creates its own simulated account; it does not place orders in your manual replay.',
    steps: [
      [
        'Start from a template',
        'Open step 1 and choose SMA crossover, RSI threshold or Donchian breakout. Give the strategy a name. You can run a template before changing its rules.',
      ],
      [
        'Adjust rules and trading costs',
        'Step 2 defines entries and exits. Step 3 sets quantity, risk, stops, targets and costs. Open step 4 only if you want to compare parameter settings.',
      ],
      [
        'Run and review',
        'Select Run backtest and wait for results below it. Save strategy keeps the rule definition; Saved runs & comparison lets you revisit or compare completed runs.',
      ],
    ],
    example:
      'Choose SMA crossover and Run backtest for a first run. Then change an indicator period under Entry & exit rules and run again. Compare the two saved runs rather than judging only the latest P&L.',
    terms: [
      [
        'Backtest fills',
        'Rules evaluate a completed candle and orders fill at the next candle’s open. Fees, slippage and protection settings affect results.',
      ],
      [
        'AND / OR',
        'AND requires every condition in a rule. OR requires at least one. An empty rule never generates a signal.',
      ],
      [
        'Cross above / below',
        'The two values must change sides between the previous candle and this one. Simply remaining above or below is not a new crossing.',
      ],
      [
        'Quantity vs equity risk',
        'Fixed quantity is the number of units per entry. Equity risk sizes the order from a percentage budget and requires a stop-loss.',
      ],
      [
        'Parameter search',
        'Try several settings at once. The default split uses the first 70% of candles to choose a winner and the last 30% to test it with a fresh account. Ranking uses training results only.',
      ],
      [
        'Basis points (bps)',
        'A unit for trading costs: 10 bps equals 0.1%. These values model commission and slippage.',
      ],
    ],
  },
};

export default function PracticeGuide({ tab }: { tab: string }) {
  const guide = guides[tab];
  if (!guide) return null;
  return (
    <aside className="practice-guide" aria-label={`${guide.title} guide`}>
      <div className="practice-guide-title">
        <BookOpen size={18} aria-hidden="true" />
        <h3>How to use {guide.title}</h3>
      </div>
      <p>{guide.purpose}</p>
      <ol>
        {guide.steps.map(([title, instruction]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{instruction}</span>
          </li>
        ))}
      </ol>
      <details>
        <summary>Example & terms explained</summary>
        <p className="practice-guide-example">
          <strong>Example</strong>
          {guide.example}
        </p>
        <dl>
          {guide.terms.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}
