import { useEffect, useState } from 'react';
import { PlanLine, Status, Size, Avatar, Icon } from '../ui.jsx';

/* ---------- small drawings of real screens, built from the app's own pieces ---------- */
const Frame = ({ title, children, wide }) => (
  <div className={`mock${wide ? ' wide' : ''}`}>
    {title && <div className="mock-title">{title}</div>}
    {children}
  </div>
);
const Target = ({ edge, name, where, status, size = 'medium', children }) => (
  <div className={`mock-target ${edge || ''}`}>
    <div className="gap8" style={{ justifyContent: 'space-between' }}>
      <strong>{name}</strong>
      <span className="gap8">
        {size && <Size s={size} />}
        {status && <Status s={status} />}
      </span>
    </div>
    {where && <div className="tiny muted">{where}</div>}
    {children}
  </div>
);
const Box = ({ children, h = 34 }) => <div className="mock-input" style={{ minHeight: h }}>{children}</div>;
const Btn = ({ children, primary }) => <span className={`btn sm${primary ? ' primary' : ''}`}>{children}</span>;
const Arrow = () => <span className="mock-arrow" aria-hidden="true">→</span>;

const DrawToday = () => (
  <Frame title="Today · Wed, 7 Oct">
    <div className="mock-bucket">Overdue</div>
    <Target edge="overdue" name="Phone OTP login" where="Project A / Login and onboarding" status="in_progress" size="large" />
    <div className="mock-bucket">Due today</div>
    <Target edge="due_today" name="Welcome tour" where="Project A / Login and onboarding" status="not_started" size="small" />
    <div className="mock-bucket">Added by your admin</div>
    <Target edge="adhoc" name="Client call at 4 PM" size={null} />
  </Frame>
);

const DrawGroups = () => (
  <Frame title="How your list is grouped">
    {[
      ['overdue', 'Overdue', 'Past its planned finish'],
      ['sent_back', 'Sent back', 'Your admin asked for changes'],
      ['due_today', 'Due today', 'Finish and submit today'],
      ['', 'Working on', 'Inside its planned dates'],
      ['', 'Blocked', 'Waiting on something'],
      ['', 'Up next', 'Nothing due, so start this'],
      ['adhoc', 'Added by your admin', 'A one-off task for today'],
    ].map(([edge, t, d]) => (
      <div key={t} className={`mock-row ${edge}`}>
        <strong>{t}</strong>
        <span className="muted small">{d}</span>
      </div>
    ))}
  </Frame>
);

const DrawLog = () => (
  <Frame title="Log your day">
    <Target edge="due_today" name="Welcome tour" where="Project A / Login and onboarding" status="in_progress" size="small">
      <div className="mock-logline">
        <Box h={44}>Built the three welcome screens and the skip button</Box>
        <Box>3 h</Box>
      </div>
    </Target>
    <div className="mock-bucket">Anything else</div>
    <div className="mock-logline three">
      <Box>Meeting</Box>
      <Box>Sprint planning with the team</Box>
      <Box>1 h</Box>
    </div>
    <div className="mock-bar">
      <span className="small">
        <strong>4</strong> hours logged
      </span>
      <Btn>Save draft</Btn>
      <Btn primary>Submit day</Btn>
    </div>
  </Frame>
);

const DrawClock = ({ items }) => (
  <Frame title="Your day">
    <div className="mock-clock">
      {items.map(([t, d]) => (
        <div key={t} className="mock-tick">
          <span className="mock-time">{t}</span>
          <span className="small">{d}</span>
        </div>
      ))}
    </div>
  </Frame>
);

const Steps = ({ items }) => (
  <div className="mock-steps">
    {items.map(([pill, how], n) => (
      <div key={n} className="mock-step">
        <Status s={pill} />
        {how && <span className="mock-down">↓ {how}</span>}
      </div>
    ))}
  </div>
);
const DrawStatus = () => (
  <Frame title="A feature's journey">
    <div className="mock-two">
      <Steps
        items={[
          ['not_started', 'you log hours on it'],
          ['in_progress', 'you press Mark as done'],
          ['submitted', 'your admin approves'],
          ['done', null],
        ]}
      />
      <Steps
        items={[
          ['in_progress', "you press I'm blocked, with a reason"],
          ['blocked', 'you press No longer blocked'],
          ['in_progress', null],
        ]}
      />
    </div>
  </Frame>
);

const DrawSubmit = () => (
  <Frame title={'Mark "Welcome tour" as done'}>
    <div className="mock-label">What did you finish? (at least 30 characters)</div>
    <Box h={52}>Three welcome screens with skip and back, tested on Android and iPhone.</Box>
    <div className="mock-label">Documents</div>
    <div className="files">
      <span className="mock-file">test-checklist.pdf</span>
      <span className="mock-file">screens.png</span>
    </div>
    <div className="mock-label">Links</div>
    <Box>https://build.example.com/welcome-tour</Box>
    <div className="mock-bar">
      <Btn>Cancel</Btn>
      <Btn primary>Send for review</Btn>
    </div>
  </Frame>
);

const DrawSentBack = () => (
  <Frame title="Sent back">
    <Target edge="sent_back" name="Profile setup" where="Project A / Login and onboarding" status="in_progress" size="medium">
      <div className="mock-why">Admin's note: Photo upload fails on slow networks. Add a retry and a progress bar.</div>
    </Target>
  </Frame>
);

const DrawPlan = () => (
  <Frame title="Project A">
    <div className="gap8 small" style={{ justifyContent: 'space-between' }}>
      <span>2 of 9 features done, 1 in review</span>
      <strong>On track</strong>
    </div>
    <div className="mt8">
      <PlanLine done={33} review={11} expected={40} />
    </div>
    <div className="legend mt16">
      <span>
        <i className="k-done" />
        Done (approved)
      </span>
      <span>
        <i className="k-review" />
        In review
      </span>
      <span>
        <i className="k-tick" />
        Where the plan says it should be today
      </span>
    </div>
    <div className="gap8 mt16 small">
      <Size s="small" /> Small <Size s="medium" /> Medium <Size s="large" /> Large
      <span className="muted">· bigger features count for more</span>
    </div>
  </Frame>
);

const DrawPropose = () => (
  <Frame title="Suggest a feature for Job scheduling">
    <div className="mock-label">Feature name</div>
    <Box>Recurring jobs</Box>
    <div className="mock-label">Size</div>
    <div className="seg">
      <button type="button">Small</button>
      <button type="button" className="on">
        Medium
      </button>
      <button type="button">Large</button>
    </div>
    <div className="mock-label">Why is it needed?</div>
    <Box h={44}>Clients book monthly visits; without repeats each one is entered by hand.</Box>
    <div className="mock-flow mt16">
      <Status s="proposed" />
      <Arrow />
      <span className="tiny muted">admin accepts and sets the size</span>
      <Arrow />
      <Status s="not_started" />
    </div>
  </Frame>
);

const DrawAddModule = () => (
  <Frame title="Project A">
    <div className="mock-row">
      <span className="gap8 small">
        <Size s="medium" /> <strong>Job scheduling</strong>
        <span className="tiny muted">Teammate C · due Wed, 14 Oct</span>
      </span>
      <Btn primary>Join module</Btn>
    </div>
    <div className="mock-row">
      <span className="gap8 small">
        <Size s="large" /> <strong>Offline mode</strong> <span className="tag">Added by you</span>
      </span>
      <span className="gap8">
        <Btn>Add feature</Btn>
        <Btn>Assign people</Btn>
      </span>
    </div>
    <div className="mock-label">New module</div>
    <div className="mock-two">
      <div>
        <div className="mock-label">Starts on</div>
        <Box>Mon, 12 Oct</Box>
      </div>
      <div>
        <div className="mock-label">Deadline</div>
        <Box>Fri, 23 Oct</Box>
      </div>
    </div>
    <div className="mock-label">Features</div>
    <div className="gap8 small mb8">
      <Size s="large" /> Save jobs without signal
    </div>
    <div className="gap8 small">
      <Size s="small" /> Sync when back online
    </div>
    <div className="mock-label">Who works on it</div>
    <div className="gap8 small">
      <span className="avatar sm">TA</span> You
      <span className="avatar sm">TB</span> Teammate B
    </div>
  </Frame>
);

const DrawTalk = () => (
  <Frame title="Comments and notifications">
    <div className="mock-comment">
      <Avatar name="Teammate A" />
      <div>
        <strong className="small">Teammate A</strong>
        <div className="small">The API returns dates in UTC. Should the app show IST?</div>
      </div>
    </div>
    <div className="mock-comment">
      <Avatar name="Abhijay Jain" />
      <div>
        <strong className="small">Abhijay Jain</strong>
        <div className="small">Yes, IST everywhere for now.</div>
      </div>
    </div>
    <div className="mock-notes">
      <div className="gap8">
        <Icon name="bell" /> <strong>Notifications</strong> <span className="mock-count">3</span>
      </div>
      <div className="small">Welcome tour was approved</div>
      <div className="small">You were assigned to module Reports</div>
      <div className="small muted">Log today's work before you leave</div>
    </div>
  </Frame>
);

const DrawReady = ({ items }) => (
  <Frame title="You're set">
    {items.map((t) => (
      <div key={t} className="mock-check">
        <span className="mock-tickbox">✓</span>
        <span>{t}</span>
      </div>
    ))}
  </Frame>
);

/* ---------- admin drawings ---------- */
const DrawJobs = () => (
  <Frame title="What admins do">
    <div className="mock-grid4">
      {[
        ['ventures', 'Set up', 'Ventures, calendars, people'],
        ['projects', 'Plan', 'Projects, modules, features'],
        ['reviews', 'Review', 'Approve finished work'],
        ['flags', 'Watch', 'Flags for anything slipping'],
      ].map(([i, t, d]) => (
        <div key={t} className="mock-tile">
          <Icon name={i} />
          <strong>{t}</strong>
          <span className="small muted">{d}</span>
        </div>
      ))}
    </div>
  </Frame>
);

const MENU = [
  ['home', 'Command centre', 'What needs you today'],
  ['portfolio', 'Portfolio', 'Every project by venture'],
  ['team', 'Team today', "Who logged, who didn't"],
  ['workload', 'Workload', 'Who is loaded in the next 2 weeks'],
  ['reviews', 'Review queue', 'Finished work and proposals'],
  ['flags', 'Flags', 'Everything slipping, and history'],
  ['ventures', 'Ventures and calendar', 'Days off, holidays, rules'],
  ['people', 'People', 'Add and manage people'],
  ['import', 'Import', 'Load work from a spreadsheet'],
  ['today', 'My day', 'Your own targets, if assigned'],
];
const DrawMenu = () => (
  <Frame title="The menu">
    <div className="mock-menu">
      {MENU.map(([i, t, d]) => (
        <div key={t} className="mock-menurow">
          <span className="mock-rail-item">
            <Icon name={i} />
            {t}
          </span>
          <span className="small muted">{d}</span>
        </div>
      ))}
    </div>
  </Frame>
);

const DrawCommand = () => (
  <Frame title="Command centre" wide>
    <div className="mock-counters">
      {[
        ['2', 'Projects at risk', 'hot'],
        ['4', 'Overdue features', 'hot'],
        ['1', 'Waiting for your review', 'warm'],
        ['1', 'Proposed by the team', 'warm'],
      ].map(([n, l, c]) => (
        <div key={l} className={`mock-counter ${c}`}>
          <span className="n">{n}</span>
          <span className="tiny muted">{l}</span>
        </div>
      ))}
    </div>
    <div className="mock-flag red">
      <span className="sev red">Overdue</span> <strong className="small">Calendar view is 1 working day late</strong>
      <div className="tiny muted">Project A / Job scheduling. Owner: Teammate C.</div>
    </div>
    <div className="mock-flag amber">
      <span className="sev amber">Stalled</span> <strong className="small">No work logged on Blog posts for 3 working days</strong>
    </div>
    <div className="mt8">
      <div className="gap8 small" style={{ justifyContent: 'space-between' }}>
        <strong>Project B</strong>
        <span className="healthword red">Behind</span>
      </div>
      <PlanLine done={10} review={8} expected={33} />
    </div>
  </Frame>
);

const DrawVenture = () => (
  <Frame title="Ventures and calendar">
    <div className="mock-label">Weekly days off</div>
    <div className="seg">
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
        <button type="button" key={i} className={i === 0 ? 'on' : ''}>
          {d}
        </button>
      ))}
    </div>
    <div className="mock-label">Holidays</div>
    <div className="mock-row">
      <strong>Fri, 20 Oct</strong>
      <span className="small">Diwali</span>
    </div>
    <div className="mock-label">Size weights</div>
    <div className="gap8 small">
      <Size s="small" /> 1 <Size s="medium" /> 2 <Size s="large" /> 4
    </div>
    <div className="mock-label">Flag rules</div>
    <div className="small muted">Review waits over 2 days · blocked over 2 days · no log for 3 days</div>
  </Frame>
);

const DrawPeople = () => (
  <Frame title="Add a person">
    <div className="mock-label">Name</div>
    <Box>Teammate A</Box>
    <div className="mock-label">Work email</div>
    <Box>teammate.a@example.com</Box>
    <div className="mock-label">Role</div>
    <div className="seg">
      <button type="button" className="on">
        Workforce
      </button>
      <button type="button">Admin</button>
    </div>
    <div className="mock-label">Temporary password</div>
    <Box>••••••••••</Box>
    <div className="tiny muted mt8">They sign in with this, see the team walkthrough, then change it under My account.</div>
  </Frame>
);

const DrawTree = () => (
  <Frame title="How work is organised" wide>
    <div className="mock-tree">
      <div className="node v">
        <span className="tiny muted">Venture</span>
        <strong>Astute Group</strong>
      </div>
      <div className="node p">
        <span className="tiny muted">Project</span>
        <strong>Project A</strong>
      </div>
      <div className="node m">
        <span className="tiny muted">Module · size, start, working days</span>
        <strong>
          Login and onboarding <Size s="large" />
        </strong>
        <span className="tiny">Starts 24 Sept · 12 working days</span>
      </div>
      <div className="node f">
        <span className="tiny muted">Features · each with a size</span>
        <span className="gap8 small">
          <Size s="large" /> Phone OTP login
        </span>
        <span className="gap8 small">
          <Size s="medium" /> Profile setup
        </span>
        <span className="gap8 small">
          <Size s="small" /> Welcome tour
        </span>
      </div>
    </div>
  </Frame>
);

const DrawAssign = () => (
  <Frame title="Who does what, and when" wide>
    <div className="mock-gantt">
      {[
        ['Phone OTP login', 'TA', 0, 55],
        ['Welcome tour', 'TA', 55, 45],
        ['Profile setup', 'TB', 0, 65],
        ['Role permissions', 'TB', 65, 35],
      ].map(([n, who, l, w]) => (
        <div key={n} className="g-row">
          <span className="g-name small">
            <span className="avatar sm">{who}</span>
            {n}
          </span>
          <span className="g-track">
            <span className="g-bar" style={{ left: `${l}%`, width: `${w}%` }} />
          </span>
        </div>
      ))}
      <div className="g-row">
        <span className="g-name tiny muted">Module window</span>
        <span className="g-track axis">
          <span>24 Sept</span>
          <span>9 Oct</span>
        </span>
      </div>
    </div>
    <div className="tiny muted mt8">Dates are planned for you by size, one lane per person. Set them by hand on any feature.</div>
  </Frame>
);

const DrawImport = () => (
  <Frame title="Import from a spreadsheet" wide>
    <div className="scroll-x">
      <table className="mock-table">
        <thead>
          <tr>
            {['venture', 'project', 'module', 'module_size', 'module_start', 'module_days', 'feature', 'feature_size', 'assignees'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {['Astute Group', 'Project A', 'Reports', 'small', '2026-10-12', '6', 'Weekly PDF', 'medium', 'teammate.d@…'].map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
          <tr>
            {['Astute Group', 'Project A', 'Reports', 'small', '2026-10-12', '6', 'Excel export', 'small', 'teammate.d@…'].map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
    <div className="mock-flow mt16 small">
      <Btn>Download template</Btn>
      <Arrow /> fill it in <Arrow /> <Btn>Check file</Btn> <Arrow /> <Btn primary>Import</Btn>
    </div>
  </Frame>
);

const DrawReview = () => (
  <Frame title="Review queue">
    <div className="mock-target due_today">
      <div className="gap8" style={{ justifyContent: 'space-between' }}>
        <strong>Welcome tour</strong>
        <span className="tiny muted">Teammate A, 2 h ago</span>
      </div>
      <div className="quote mt8 small">Three welcome screens with skip and back, tested on Android and iPhone.</div>
      <div className="files">
        <span className="mock-file">test-checklist.pdf</span>
      </div>
      <div className="gap8 mt8">
        <Btn primary>Approve</Btn>
        <Btn>Send back with a reason</Btn>
      </div>
    </div>
    <div className="mock-target">
      <div className="gap8" style={{ justifyContent: 'space-between' }}>
        <strong>Recurring jobs</strong>
        <Status s="proposed" />
      </div>
      <div className="tiny muted">Proposed by Teammate C for Job scheduling</div>
      <div className="gap8 mt8">
        <Btn primary>Accept as Medium</Btn>
        <Btn>Decline</Btn>
      </div>
    </div>
  </Frame>
);

const DrawFlags = () => (
  <Frame title="Flags (only admins see these)">
    {[
      ['red', 'Overdue', 'Past its planned finish'],
      ['red', 'Blocked', 'Stuck longer than your limit'],
      ['red', 'Behind schedule', 'Less done than the plan expects'],
      ['amber', 'Stalled', 'No work logged for days'],
      ['amber', 'Review waiting', 'Finished work not reviewed'],
      ['amber', 'Missing logs', 'Two days without a daily log'],
      ['amber', 'Overloaded', 'Too much due in 2 days'],
      ['amber', 'Unassigned', 'Nobody on work about to start'],
      ['amber', 'Scope growth', 'Added features pile up'],
    ].map(([sev, t, d]) => (
      <div key={t} className="mock-row">
        <span className={`sev ${sev}`}>{t}</span>
        <span className="small muted">{d}</span>
      </div>
    ))}
  </Frame>
);

const DrawTeam = () => (
  <Frame title="Team today and workload" wide>
    <table className="mock-table">
      <thead>
        <tr>
          <th>Person</th>
          <th>Targets</th>
          <th>Daily log</th>
          <th>Hours</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Teammate B</td>
          <td>2/3</td>
          <td className="ok">Submitted</td>
          <td>7</td>
        </tr>
        <tr>
          <td>Teammate C</td>
          <td>0/4</td>
          <td className="muted">Not started</td>
          <td>0</td>
        </tr>
      </tbody>
    </table>
    <div className="mock-heat mt16">
      <span className="small">Teammate D</span>
      {[0, 1, 2, 3, 4, 2, 1, 0, 1, 2].map((l, i) => (
        <span key={i} className={`c l${l}`} />
      ))}
    </div>
    <div className="tiny muted mt8">Darker cells = more features planned that day.</div>
  </Frame>
);

const DrawHealth = () => (
  <Frame title="Progress and health">
    {[
      ['green', 'On track', 46, 8, 50],
      ['amber', 'Slipping', 30, 6, 45],
      ['red', 'Behind', 15, 5, 55],
    ].map(([h, t, d, r, e]) => (
      <div key={t} className="mt8">
        <div className="gap8 small" style={{ justifyContent: 'space-between' }}>
          <span className="gap8">
            <span className={`dot ${h}`} />
            <strong>{t}</strong>
          </span>
          <span className="tiny muted">
            {d + r}% done or in review, plan expects {e}%
          </span>
        </div>
        <PlanLine done={d} review={r} expected={e} thin showPct={false} />
      </div>
    ))}
  </Frame>
);

/* ---------- the steps ---------- */
const TEAM = [
  {
    title: 'Welcome to the Astute work tracker',
    draw: <DrawToday />,
    body: (
      <>
        <p>Every working day you get a list of what to work on. You write down what you did, and send finished work to your admin for review.</p>
        <p>This walkthrough takes about three minutes. It shows every part of the app you will use.</p>
      </>
    ),
  },
  {
    title: 'Your Today list',
    draw: <DrawGroups />,
    body: (
      <>
        <p>
          <strong>Today</strong> is the first screen you see. Your list is built at 7:00 AM from the dates your admin planned.
        </p>
        <p>Work is grouped by what needs attention first. Start at the top: overdue and sent-back work comes before anything new.</p>
      </>
    ),
  },
  {
    title: 'Log what you did',
    draw: <DrawLog />,
    body: (
      <>
        <p>Under each target, write what you did today and pick the hours, in half-hour steps.</p>
        <p>
          Meetings, support or other work go under <strong>Anything else</strong>. <strong>Save draft</strong> keeps your notes;{' '}
          <strong>Submit day</strong> sends the day's log.
        </p>
      </>
    ),
  },
  {
    title: 'When to log',
    draw: (
      <DrawClock
        items={[
          ['7:00 AM', "Today's list is ready"],
          ['6:30 PM', 'Reminder if you have not submitted'],
          ['11:00 AM', 'Next working day: yesterday’s log locks'],
        ]}
      />
    ),
    body: (
      <>
        <p>Submit your log before you leave. You can still edit it until 11:00 AM on the next working day; after that it locks.</p>
        <p>Missing two days in a row shows up for your admin.</p>
      </>
    ),
  },
  {
    title: 'Starting work and getting stuck',
    draw: <DrawStatus />,
    body: (
      <>
        <p>Logging hours on a feature for the first time moves it to In progress. You don't need to change it yourself.</p>
        <p>
          If you can't go on, press <strong>I'm blocked</strong> and say what you are waiting for. Your admin sees it straight away. Press <strong>No longer
          blocked</strong> when it's sorted.
        </p>
      </>
    ),
  },
  {
    title: 'Mark a feature as done',
    draw: <DrawSubmit />,
    body: (
      <>
        <p>
          When a feature is finished, press <strong>Mark as done</strong>. Describe what you finished in at least 30 characters, and attach documents
          or links.
        </p>
        <p>Some features need proof: a document or a link is then required. The feature shows In review until your admin approves it.</p>
      </>
    ),
  },
  {
    title: 'If work is sent back',
    draw: <DrawSentBack />,
    body: (
      <>
        <p>
          If your admin asks for changes, the feature comes back to your list under <strong>Sent back</strong>, with their note.
        </p>
        <p>Fix what they asked, then mark it as done again.</p>
      </>
    ),
  },
  {
    title: 'My work and Projects',
    draw: <DrawPlan />,
    body: (
      <>
        <p>
          <strong>My work</strong> lists everything you are on, with dates. <strong>Projects</strong> shows every venture and project, with all their modules
          and features, so you can see what is already planned.
        </p>
        <p>The bar shows approved work in black, work in review striped, and an amber marker where the plan says the project should be today.</p>
      </>
    ),
  },
  {
    title: 'Add a module, or join one',
    draw: <DrawAddModule />,
    body: (
      <>
        <p>
          Starting something new? Open the project and press <strong>Add a module</strong>. List its features with sizes, set a start date and a deadline, and
          tick anyone else who works on it. You are on it automatically, and your admin is told. No approval is needed.
        </p>
        <p>
          Someone already doing it? Press <strong>Join module</strong>, or <strong>Join</strong> beside a feature, to show your part. You can leave work you joined
          yourself. Once a deadline is set, only an admin can change the dates.
        </p>
      </>
    ),
  },
  {
    title: 'Suggest an extra feature',
    draw: <DrawPropose />,
    body: (
      <>
        <p>
          Found something a module needs that isn't listed? Press <strong>Suggest a feature</strong> beside the module, in My work or on the project page, and give it
          a size and a reason.
        </p>
        <p>
          You can start on it straight away. It counts toward progress once your admin accepts it. On a module you added yourself, use <strong>Add feature</strong>{' '}
          instead: it counts straight away.
        </p>
      </>
    ),
  },
  {
    title: 'Comments and notifications',
    draw: <DrawTalk />,
    body: (
      <>
        <p>Open any feature to comment on it. Your admin and everyone on the work are told.</p>
        <p>
          The <strong>Notifications</strong> bell tells you about approvals, sent-back work, new assignments and reminders. <strong>Log history</strong>{' '}
          shows past days, and <strong>My account</strong> is where you change your password.
        </p>
      </>
    ),
  },
  {
    title: "You're ready",
    draw: (
      <DrawReady
        items={[
          'Check Today every morning',
          'Log what you did, with hours',
          'Submit your day before you leave',
          'Mark finished work as done, with proof',
          'Say when you are blocked',
          'Add or join modules for your own work',
        ]}
      />
    ),
    body: (
      <>
        <p>That's everything. You can watch this walkthrough again any time from <strong>How it works</strong> in the menu.</p>
      </>
    ),
  },
];

const ADMIN = [
  {
    title: 'Welcome, admin',
    draw: <DrawJobs />,
    body: (
      <>
        <p>As an admin you set up ventures and people, plan projects, review finished work, and keep an eye on anything slipping.</p>
        <p>This walkthrough takes about four minutes and covers every admin screen.</p>
      </>
    ),
  },
  {
    title: 'The menu',
    draw: <DrawMenu />,
    body: (
      <>
        <p>Everything is one click away in the black menu on the left. The amber tab shows where you are.</p>
        <p>Numbers beside a menu item tell you how many things wait there.</p>
      </>
    ),
  },
  {
    title: 'Command centre: start here each morning',
    draw: <DrawCommand />,
    body: (
      <>
        <p>The counts across the top are what needs you today. Click one to go straight to it.</p>
        <p>Below them: flags, most serious first, and every active project with its plan line.</p>
      </>
    ),
  },
  {
    title: 'Set up ventures and calendars',
    draw: <DrawVenture />,
    body: (
      <>
        <p>
          In <strong>Ventures and calendar</strong>, add each venture with its weekly days off and holidays. Deadlines count working days only, so these
          matter.
        </p>
        <p>Here you also set how much small, medium and large features weigh, and when flags should fire.</p>
      </>
    ),
  },
  {
    title: 'Add people',
    draw: <DrawPeople />,
    body: (
      <>
        <p>
          In <strong>People</strong>, add everyone with their email. Choose Admin or Workforce and give a temporary password. Only people added here can
          sign in.
        </p>
        <p>Deactivate someone who leaves; their history stays.</p>
      </>
    ),
  },
  {
    title: 'Plan a project',
    draw: <DrawTree />,
    body: (
      <>
        <p>
          Create a project from <strong>New project</strong>, then add modules. A module needs a size, a start date, a length in working days, and its
          list of features.
        </p>
        <p>Every feature also has a size. Sizes decide how much each piece counts toward progress.</p>
        <p>
          The team can add modules too, and join any module or feature. You get a notification each time, and once a deadline is set only admins can change dates.
        </p>
      </>
    ),
  },
  {
    title: 'Assign people and dates',
    draw: <DrawAssign />,
    body: (
      <>
        <p>Assign people to a whole module, or to single features. Each person's features are planned one after another inside the module's dates.</p>
        <p>Change a module's start or length and the dates move with it. You can also set a feature's dates by hand.</p>
      </>
    ),
  },
  {
    title: 'Import from a spreadsheet',
    draw: <DrawImport />,
    body: (
      <>
        <p>
          Have a plan already? On <strong>Import</strong>, download the template, fill one row per feature, and upload it.
        </p>
        <p><strong>Check file</strong> shows what will be created and any mistakes, before anything is saved.</p>
      </>
    ),
  },
  {
    title: 'Review finished work',
    draw: <DrawReview />,
    body: (
      <>
        <p>
          The <strong>Review queue</strong> holds work marked as done, with the note and files. Approve it, or send it back with a reason.
        </p>
        <p>Features the team suggested wait here too: accept them with a size, or decline with a reason.</p>
      </>
    ),
  },
  {
    title: 'Flags',
    draw: <DrawFlags />,
    body: (
      <>
        <p>Flags are raised automatically every hour and clear themselves once the cause is fixed. The team never sees them.</p>
        <p>Acknowledge a flag with a note when you know the reason; it moves below the ones nobody has looked at.</p>
      </>
    ),
  },
  {
    title: 'Team today and workload',
    draw: <DrawTeam />,
    body: (
      <>
        <p>
          <strong>Team today</strong> shows who has logged, their hours and their targets. Use <strong>Add a task</strong> to put a one-off job on
          someone's day, or open their profile for their history.
        </p>
        <p>
          <strong>Workload</strong> shows how much each person has planned over the next two weeks.
        </p>
      </>
    ),
  },
  {
    title: 'How progress and health work',
    draw: <DrawHealth />,
    body: (
      <>
        <p>Only approved features count as done. Work in review shows striped. The amber marker is where the plan says you should be today.</p>
        <p>
          Health compares the two: <strong>On track</strong> at 90% of plan or better, <strong>Slipping</strong> from 70%, <strong>Behind</strong>{' '}
          below that or past the deadline.
        </p>
      </>
    ),
  },
  {
    title: "You're ready",
    draw: (
      <DrawReady
        items={['Add ventures, holidays and people', 'Create projects and modules with features', 'Assign the work', 'Review finished work daily', 'Act on flags from the Command centre']}
      />
    ),
    body: (
      <>
        <p>
          Your team gets their own walkthrough the first time they sign in. You can watch this one again any time from <strong>How it works</strong> in
          the menu.
        </p>
      </>
    ),
  },
];

/**
 * The walkthrough. On first sign-in (`required`) it cannot be closed and steps cannot be skipped:
 * the last step's button opens the app. Replayed from the menu, it can be closed and jumped through freely.
 */
export default function Tutorial({ role, required, onFinish, onClose }) {
  const steps = role === 'admin' ? ADMIN : TEAM;
  const [i, setI] = useState(0);
  const [seen, setSeen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const last = i === steps.length - 1;
  const step = steps[i];
  const go = (n) => {
    const to = Math.max(0, Math.min(steps.length - 1, n));
    if (required && to > seen + 1) return;
    setI(to);
    setSeen((s) => Math.max(s, to));
  };
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFinish();
    } catch (e) {
      setError(e.message || 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const k = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
      if (e.key === 'Escape' && !required) onClose?.();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    document.querySelector('.tour-main')?.scrollTo(0, 0);
  }, [i]);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={role === 'admin' ? 'Admin walkthrough' : 'Team walkthrough'}>
      <header className="tour-top">
        <img src="/logo-on-dark.png" alt="Astute Group" />
        <span className="tour-kind">{role === 'admin' ? 'Admin walkthrough' : 'Team walkthrough'}</span>
        {!required && (
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      <div className="tour-body">
        <ol className="tour-steps" aria-label="Steps">
          {steps.map((s, n) => {
            const reachable = !required || n <= seen + 1;
            return (
              <li key={s.title}>
                <button
                  className={`${n === i ? 'on' : ''}${n <= seen && n !== i ? ' seen' : ''}`}
                  disabled={!reachable}
                  onClick={() => go(n)}
                  aria-current={n === i ? 'step' : undefined}
                >
                  <span className="tour-n">{n < i || (n <= seen && n !== i) ? '✓' : n + 1}</span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
        <main className="tour-main">
          <div className="tour-card">
            <div className="tour-draw">{step.draw}</div>
            <div className="tour-text">
              <div className="tiny muted">
                Step {i + 1} of {steps.length}
              </div>
              <h1>{step.title}</h1>
              {step.body}
            </div>
          </div>
        </main>
      </div>
      <footer className="tour-foot">
        <div className="tour-progress">
          <div className="plan thin">
            <div className="done" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
        {error && <span className="small" style={{ color: 'var(--red)' }}>{error}</span>}
        <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>
          Back
        </button>
        {last ? (
          required ? (
            <button className="btn primary" onClick={finish} disabled={busy}>
              {busy ? 'Opening…' : 'Start working'}
            </button>
          ) : (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          )
        ) : (
          <button className="btn primary" onClick={() => go(i + 1)}>
            Next
          </button>
        )}
      </footer>
    </div>
  );
}
