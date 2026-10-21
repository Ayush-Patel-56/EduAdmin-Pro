import { useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import './landing.css'
import { useMe } from '@/features/auth/session'
import { DEMO_MAILTO, FAQ, INVITE_MAILTO, TIMETABLE_DAYS, timetable } from './content'
import { useLandingMotion } from './useLandingMotion'

const year = new Date().getFullYear()
// Tag only the clicked link so the View Transition morphs it into the auth card.
const morphIntoCard = (e: MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.setProperty('view-transition-name', 'au-card')
const barHeight = (h: string) => ({ '--h': h }) as CSSProperties

/** Public marketing page at "/". Signed-in users see "Go to dashboard" instead of "Sign in". */
export function LandingPage() {
  const root = useRef<HTMLDivElement>(null)
  const { data: me } = useMe()
  const signedIn = Boolean(me)
  useLandingMotion(root)

  return (
    <div className="lp" ref={root}>
      <a className="skip" href="#main">Skip to content</a>
      <nav id="nav"><div className="wrap">
       <a className="logo" href="#top" aria-label="EduAdmin Pro home"><b>EA</b><span>EduAdmin Pro<small>School Management</small></span></a>
       <ul><li><a href="#day">The school day</a></li><li><a href="#modules">Modules</a></li><li><a href="#portals">Portals</a></li><li><a href="#faq">Questions</a></li><li><a href="#contact">Contact</a></li></ul>
       <div className="nav-r">
        {signedIn ? (
         <Link className="nav-link" to="/app" viewTransition>Go to dashboard</Link>
        ) : (
         <Link className="nav-link" to="/login" viewTransition onClick={morphIntoCard}>Sign in</Link>
        )}
        <a className="btn mag" href={DEMO_MAILTO}>Book a demo</a>
       </div>
      </div></nav>

      <main id="main">
      <header className="hero" id="top"><div className="wrap">
       <div className="hero-top">
        <h1 id="h1"><span className="ln"><span>The whole</span></span><span className="ln"><span>school day,</span></span><span className="ln"><span><em className="it">finally</em> in <span className="u">one place.<svg className="scrib" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true"><path id="scribP" d="M4 20 C 60 8, 140 26, 200 14 S 280 10, 296 18"/></svg></span></span></span></h1>
        <div className="hero-side">
         <p className="h-in">Timetables, tests, report cards, PTM notes, fees and staff, kept together so you can stop chasing spreadsheets and get back to running a school.</p>
         <div className="ctas h-in"><a className="btn mag" href={DEMO_MAILTO}>Book a demo <span className="ar">→</span></a><a className="btn ghost mag" href="#modules">See the modules</a></div>
        </div>
       </div>
      </div>

      <div className="stage" id="stage"><div className="stage-in">
       <div className="laptop" id="laptop">
        <div className="lid"><div className="screen" id="screen">
         <div className="ui" id="ui" aria-label="Recreation of the EduAdmin Pro management dashboard" role="img">
          <aside className="as">
           <div className="logo"><b>EA</b><span>EduAdmin Pro<small>School Management</small></span></div>
           <nav className="side">
            <a className="on"><i></i>Dashboard</a><a><i></i>Academic Planning</a><a><i></i>Curriculum</a><a><i></i>Recruitment</a><a><i></i>Student Reports</a><a><i></i>Students</a><a><i></i>Teacher Portal</a><a><i></i>Daily Reports</a><a><i></i>Fee Management</a><a><i></i>Tests &amp; Question Bank</a><a><i></i>Attendance</a><a><i></i>Feedback</a><a><i></i>Counseling</a><a><i></i>Meetings</a><a><i></i>Calendar</a>
           </nav>
          </aside>
          <div className="col">
           <header className="as"><span className="sel"><span className="d" style={{ background: '#6366f1' }}></span>Your School</span><span className="sel">All programs</span><span className="sel">All batches</span><span className="av">A</span></header>
           <div className="pg">
            <h4 className="as">Dashboard <span className="dt"></span> <span className="sn">Your School</span></h4>
            <p className="sub as">Overview of academic background and ongoing management tasks</p>
            <div className="grid12">
             <div className="kpi as" style={{ gridColumn: 'span 4' }}><div className="lab">Attendance today</div><div className="kv"><span id="k1">92</span>%</div><div className="kb"><i id="k1b"></i></div></div>
             <div className="kpi as" style={{ gridColumn: 'span 4' }}><div className="lab">Daily reports filed</div><div className="kv"><span id="k2">14</span><small>/24</small></div><div className="kb"><i id="k2b" className="em"></i></div></div>
             <div className="kpi as hide-m" style={{ gridColumn: 'span 4' }}><div className="lab">Tests this week</div><div className="kv"><span id="k3">5</span></div><svg className="spark" viewBox="0 0 120 24" preserveAspectRatio="none"><polyline id="spk" points="0,18 20,14 40,16 60,9 80,12 100,6 120,8"/></svg></div>
             <div className="crd as" style={{ gridColumn: 'span 7' }}><h6><i></i>School Background</h6>
              <div className="tiles"><div className="tile"><div className="lab">Current Board</div><div className="val">CBSE</div></div><div className="tile"><div className="lab">Active Classes</div><div className="val">Class 9 – 12</div></div><div className="tile"><div className="lab">Programs Offered</div><div className="val">JEE, NEET</div></div><div className="tile mou"><div><div className="lab">MOU Status</div><div className="val">Active</div></div><span className="chk"></span></div></div></div>
             <div className="crd as" style={{ gridColumn: 'span 3' }}><h6><i></i>Quick Actions</h6><div className="qa-btn"><i></i>Update Macro Plan</div><div className="qa-btn"><i></i>Add a test</div><div className="qa-btn hide-m"><i></i>Record PTM note</div></div>
             <div className="crd as hide-m" style={{ gridColumn: 'span 2' }}><h6><i></i>Announcements</h6><div style={{ color: 'var(--s400)', fontStyle: 'italic', fontSize: '10px', textAlign: 'center', paddingTop: '16px' }}>Nothing new</div></div>
             <div className="as" style={{ gridColumn: 'span 5' }}><div className="invite t"><div className="lab">Teacher Invite Code</div><div className="code">GFCZ-BBYB</div></div><div className="invite a"><div className="lab">Admin Invite Code</div><div className="code">KQ7M-3XTR</div></div></div>
             <div className="crd as" style={{ gridColumn: 'span 7', padding: '0' }}><h6 style={{ padding: '10px 10px 0' }}>Today's classes</h6>
              <table className="sch"><thead><tr><th>Time</th><th>Class</th><th className="hide-m">Batch</th><th>Room</th></tr></thead>
              <tbody><tr><td>09:00</td><td><b>Physics</b><span className="live">Live</span></td><td className="hide-m">JEE · A</td><td>R-12</td></tr><tr><td>10:30</td><td><b>Biology</b></td><td className="hide-m">NEET · B</td><td>Lab 2</td></tr><tr><td>12:00</td><td><b>Mathematics</b></td><td className="hide-m">JEE · A</td><td>R-12</td></tr></tbody></table></div>
            </div>
           </div>
          </div>
         </div>
         <div className="toast" id="toast" aria-live="off"><span className="tdot"></span><div><b id="tTitle">Attendance marked</b><small id="tSub">Class 9 · A · just now</small></div></div>
         <div className="cursor" id="cur" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#0f2147" stroke="#fff" strokeWidth="1.5"/></svg></div>
        </div></div>
        <div className="base"></div>
       </div>
      </div></div>
      </header>

      <section className="sec" id="day"><div className="wrap tt-wrap">
       <div>
        <p className="kicker reveal"><span className="pulse"></span>Today · <span id="liveTime">9:00 am</span></p>
        <h2 className="big mask"><span className="ln"><span>Every period,</span></span><span className="ln"><span>every room,</span></span><span className="ln"><span><em className="it">every teacher.</em></span></span></h2>
        <p className="lede reveal">Plan programs and batches once, schedule the week, and each teacher sees their own day the moment they sign in. No more photocopied timetables on the staffroom wall.</p>
       </div>
       <div className="tt reveal" id="tt" aria-label="Illustrative weekly timetable">
        <span className="note hand" id="n2">Current period, highlighted live</span>
        <Timetable />
       </div>
      </div></section>

      <section className="hz" id="modules" aria-label="Modules">
       <div className="wrap hz-head">
        <div><p className="kicker">What's inside</p><h2 className="big" style={{ marginTop: '18px' }}>One login.<br /><em className="it">Every corner</em> of the school.</h2></div>
        <p>Each module below is a real part of the product. The screens are recreated from the app itself.</p>
       </div>
       <div className="track" id="track">
        <article className="panel"><div className="shot"><div className="bar">Academic Planning</div><div className="tabs"><span className="on">Programs</span><span>Batches</span><span>Schools</span></div><div className="rw"><b>JEE</b><span className="r pill">2 batches</span></div><div className="rw"><b>NEET</b><span className="r pill">1 batch</span></div><div className="rw"><b>Foundation</b><span className="r pill s">Draft</span></div><div className="rw"><span>Macro plan · Term 1</span><span className="r pill g">Updated</span></div></div><p className="n">01</p><h3>Academic Planning</h3><p>Programs, batches, macro plans and the curriculum. Set up the year in one place.</p></article>
        <article className="panel"><div className="shot"><div className="bar">Tests &amp; Question Bank <span className="pill">Physics</span></div><div className="rw" style={{ display: 'block' }}><b>Q4.</b> A body moves with uniform velocity. Its acceleration is:<div className="opt">increasing</div><div className="opt ok">zero ✓</div><div className="opt">decreasing</div></div><div className="rw"><span>Unit Test 2 · 30 questions</span><span className="r pill y">Scheduled</span></div></div><p className="n">02</p><h3>Tests &amp; Question Bank</h3><p>Build tests from a shared bank, then record marks and results.</p></article>
        <article className="panel"><div className="shot"><div className="bar">Student Reports <span className="pill g">Class overview</span></div><div className="lab" style={{ marginBottom: '6px' }}>Mistake analysis · by topic</div><div className="linec"><svg viewBox="0 0 300 110" preserveAspectRatio="none"><path className="gl" d="M0 27H300M0 55H300M0 83H300"/><path className="ln1" d="M0 80 C40 70,60 40,100 48 S160 30,200 36 S260 14,300 20"/><path className="ln2" d="M0 95 C40 88,70 70,100 74 S170 60,200 66 S260 50,300 52"/></svg><div className="lg"><span><i></i>Class average</span><span><i className="a"></i>Needs practice</span></div></div><div className="rw" style={{ marginTop: '8px' }}><span>Progress report · Term 1</span><span className="r pill">Export</span></div></div><p className="n">03</p><h3>Student Reports</h3><p>Progress reports and mistake analysis that show where a child actually needs help.</p></article>
        <article className="panel"><div className="shot"><div className="bar">PTM Notes</div><div className="rw" style={{ display: 'block' }}><b>Parent meeting · Class 10</b><p style={{ marginTop: '6px', color: 'var(--s600)', fontSize: '11px' }}>Discussed revision plan for algebra. Follow up after the next unit test.</p></div><div className="rw"><span>Follow-up</span><span className="r pill y">Next week</span></div><div className="rw"><span>Shared with</span><span className="r pill">Class teacher</span></div></div><p className="n">04</p><h3>PTM Notes</h3><p>What was said at the parent–teacher meeting stays with the student, not in someone's diary.</p></article>
        <article className="panel"><div className="shot"><div className="bar">Recruitment</div><div className="rw"><b>Physics teacher</b><span className="r pill">Interview</span></div><div className="rw"><b>Lab assistant</b><span className="r pill y">Screening</span></div><div className="rw"><b>Maths teacher</b><span className="r pill g">Offer</span></div><div className="lab" style={{ margin: '12px 0 6px' }}>Faculty appraisal</div><div className="rw"><span>Term review</span><span className="r pill s">In progress</span></div></div><p className="n">05</p><h3>Recruitment &amp; Appraisal</h3><p>Hire, onboard and review your faculty in the same system they teach from.</p></article>
        <article className="panel"><div className="shot"><div className="bar">Fee Management</div><div className="rw"><b>Term 1 fees</b><span className="r pill g">Paid</span></div><div className="rw"><b>Term 2 fees</b><span className="r pill y">Due</span></div><div className="lab" style={{ margin: '12px 0 6px' }}>Attendance · today</div><div className="rw"><span>Class 9 · A</span><span className="r pill g">Marked</span></div><div className="rw"><span>Class 10 · B</span><span className="r pill s">Pending</span></div></div><p className="n">06</p><h3>Fees &amp; Attendance</h3><p>Who's paid, who's present, without a separate tool for each.</p></article>
        <article className="panel"><div className="shot"><div className="bar">MOU Status</div><div className="tile mou" style={{ background: '#fff', padding: '14px' }}><div><div className="lab">MOU Status</div><div className="val" style={{ fontSize: '15px' }}>Active</div></div><span className="chk"></span></div><div className="rw" style={{ marginTop: '8px' }}><span>Start date</span><span className="r">On record</span></div><div className="rw"><span>End date</span><span className="r">On record</span></div><div className="rw"><span>Expiry warning</span><span className="r pill y">Shown on dashboard</span></div></div><p className="n">07</p><h3>MOUs</h3><p>Partnership agreements with their dates, right on the dashboard, so renewals don't sneak up on you.</p></article>
        <article className="panel" style={{ marginRight: '5vw' }}><div className="shot"><div className="bar">Daily Reports</div><div className="rw"><b>Physics · JEE A</b><span className="r pill g">Filed</span></div><div className="rw"><b>Biology · NEET B</b><span className="r pill g">Filed</span></div><div className="rw"><b>Maths · JEE A</b><span className="r pill s">Pending</span></div><div className="rw"><span>Export</span><span className="r pill">Spreadsheet</span></div></div><p className="n">08</p><h3>Daily Reports</h3><p>Teachers file what they covered; you see the whole school's day without walking the corridors.</p></article>
       </div>
      </section>

      <section className="story" id="story"><div className="wrap story-in" id="storyIn">
       <div>
        <p className="kicker">A day with EduAdmin Pro</p>
        <div className="clock" aria-hidden="true"><span className="tk">8:00</span><span className="tk">11:30</span><span className="tk">4:00</span><span className="tk">7:00</span></div>
        <div className="beats">
         <div className="beat"><h3>Teachers join in seconds.</h3><p>Share your school's teacher code. They sign up, verify their email, and land straight in the Faculty Portal.</p></div>
         <div className="beat"><h3>The test is already set.</h3><p>Pull questions from the bank, schedule it for the batch, and marks go straight into each student's report.</p></div>
         <div className="beat"><h3>Parents leave reassured.</h3><p>PTM notes and progress reports sit side by side, so every conversation starts from the same page.</p></div>
         <div className="beat"><h3>Your evening, in one email.</h3><p>Admins who opt in get a daily email digest of what happened across the school. Off by default; switch it on in Preferences.</p></div>
        </div>
       </div>
       <div className="morph" aria-hidden="true"><div className="mcard" id="mcard">
        <div className="m-el s1" style={{ left: '22px', right: '22px', top: '22px' }}><div className="lab">Faculty Portal · Join a school</div><div style={{ font: '700 22px var(--sans)', color: 'var(--s900)', marginTop: '8px' }}>Enter your school code</div></div>
        <div className="m-el s1" style={{ left: '22px', right: '22px', top: '110px' }}><div className="invite t" style={{ padding: '18px' }}><div className="lab">Teacher Invite Code</div><div className="code" style={{ fontSize: '28px' }}>GFCZ-BBYB</div></div></div>
        <div className="m-el s1" style={{ left: '22px', right: '22px', top: '230px' }}><div className="rw" style={{ padding: '14px' }}><b>Verification code sent</b><span className="r pill">6 digits</span></div><div className="rw" style={{ padding: '14px' }}><b>Joined Your School</b><span className="r pill g">Teacher</span></div></div>
        <div className="m-el s2" style={{ left: '22px', right: '22px', top: '22px' }}><div className="lab">Tests &amp; Question Bank</div><div style={{ font: '700 22px var(--sans)', color: 'var(--s900)', marginTop: '8px' }}>Unit Test 2 · Physics</div></div>
        <div className="m-el s2" style={{ left: '22px', right: '22px', top: '100px' }}><div className="rw" style={{ display: 'block', padding: '16px', fontSize: '14px' }}><b>Q1.</b> SI unit of force is:<div className="opt">joule</div><div className="opt ok">newton ✓</div><div className="opt">watt</div></div></div>
        <div className="m-el s2" style={{ left: '22px', right: '22px', top: '300px' }}><div className="rw" style={{ padding: '14px' }}><b>Batch JEE · A</b><span className="r pill y">Scheduled</span></div></div>
        <div className="m-el s3" style={{ left: '22px', right: '22px', top: '22px' }}><div className="lab">Student Reports</div><div style={{ font: '700 22px var(--sans)', color: 'var(--s900)', marginTop: '8px' }}>Progress · Term 1</div></div>
        <div className="m-el s3" style={{ left: '22px', right: '22px', top: '100px' }}><div className="bars" style={{ height: '150px' }}><span style={barHeight('60%')}></span><span className="m" style={barHeight('85%')}></span><span style={barHeight('45%')}></span><span style={barHeight('70%')}></span><span style={barHeight('35%')}></span></div></div>
        <div className="m-el s3" style={{ left: '22px', right: '22px', top: '280px' }}><div className="rw" style={{ padding: '14px', display: 'block' }}><b>PTM note</b><p style={{ fontSize: '13px', color: 'var(--s600)', marginTop: '4px' }}>Focus on optics before the next test. Parents will check in after.</p></div></div>
        <div className="m-el s4" style={{ left: '22px', right: '22px', top: '22px' }}><div className="lab">Inbox</div><div style={{ font: '700 22px var(--sans)', color: 'var(--s900)', marginTop: '8px' }}>Daily digest · Your School</div></div>
        <div className="m-el s4" style={{ left: '22px', right: '22px', top: '100px' }}><div className="mail"><div className="rw"><span>Daily reports filed</span><span className="r pill g">Today</span></div><div className="rw"><span>PTM notes added</span><span className="r pill">Today</span></div><div className="rw"><span>Tests scheduled</span><span className="r pill y">This week</span></div><p style={{ color: 'var(--s500)', fontSize: '12px', marginTop: '8px' }}>Turn off any time in Preferences.</p></div></div>
       </div></div>
      </div></section>

      <section className="sec" id="portals" style={{ paddingBottom: '24px' }}><div className="wrap">
       <p className="kicker reveal">Two portals, one school</p>
       <h2 className="big mask" style={{ maxWidth: '16ch', margin: '20px 0 44px' }}><span className="ln"><span>The right desk</span></span><span className="ln"><span>for <em className="it">everyone</em> in the building.</span></span></h2>
       <div className="split">
        <div className="reveal"><span className="mono">/management</span><h3>For owners &amp; principals</h3><p style={{ color: 'var(--s600)' }}>See every school you run and switch between them from the top bar.</p><ul><li>Academic planning, curriculum and calendar</li><li>Fees, attendance and daily reports</li><li>Recruitment, faculty appraisal and MOUs</li><li>Invite codes you can regenerate any time</li></ul></div>
        <div className="reveal"><span className="mono">/teacher</span><h3>For teachers &amp; staff</h3><p style={{ color: 'var(--s600)' }}>A focused portal with just their classes. Nothing to configure.</p><ul><li>Their own class schedule</li><li>Tests, marks and student reports</li><li>PTM notes and daily reports</li><li>Join with the school's teacher code</li></ul></div>
       </div>
      </div></section>

      <section className="finale" id="finale"><div className="wrap fin">
       <div>
        <p className="kicker reveal">The end-of-term result</p>
        <h2 className="big mask"><span className="ln"><span>Less paperwork.</span></span><span className="ln"><span>More <em className="it">teaching.</em></span></span></h2>
        <p className="lede reveal">We'll set up your school (programs, batches and staff codes) and walk your team through it. You get a calmer staffroom; your teachers get their evenings back.</p>
        <div className="ctas reveal" style={{ display: 'flex', gap: '12px', marginTop: '34px', flexWrap: 'wrap' }}><a className="btn mag" id="cta" href={DEMO_MAILTO}>Book a demo <span className="ar">→</span></a><a className="btn ghost mag" href="#contact">Get in touch</a></div>
       </div>
       <div className="rc" id="rc" aria-label="Report card illustration">
        <h3>Report Card</h3><p className="sub2">Your School · Term 1</p>
        <table><tbody>
         <tr><td>Timetables in one place</td><td><span>✓</span></td></tr>
         <tr><td>Tests &amp; results recorded</td><td><span>✓</span></td></tr>
         <tr><td>PTM notes kept</td><td><span>✓</span></td></tr>
         <tr><td>Fees &amp; attendance tracked</td><td><span>✓</span></td></tr>
         <tr><td>Staff hired &amp; appraised</td><td><span>✓</span></td></tr>
        </tbody></table>
        <div className="stamp" id="stamp"><div>A+<small>Well done</small></div></div>
       </div>
      </div></section>

      <Faq />
      </main>

      <footer className="contact" id="contact"><div className="wrap">
       <p className="kicker" style={{ color: '#8d97bd' }}>Contact</p>
       <h2 style={{ marginTop: '20px' }} className="mask"><span className="ln"><span>Let's get your</span></span><span className="ln"><span><em className="it">school</em> set up.</span></span></h2>
       <p className="cl">Tell us a little about your school and we'll reply with a time for a walkthrough.</p>
       <a className="mail-big" href="mailto:academicplanningsystem@gmail.com?subject=Hello%20from%20the%20EduAdmin%20Pro%20website">academicplanningsystem@gmail.com</a>
       <div className="cgrid">
        <div><h4>Book a demo</h4><a href={DEMO_MAILTO}>Request a walkthrough →</a></div>
        <div><h4>Set up my school</h4><Link to="/signup" viewTransition onClick={morphIntoCard}>Create your account →</Link><p className="hint">New schools need an admin invite code. <a href={INVITE_MAILTO}>Ask us for one</a>.</p></div>
        <div><h4>Questions</h4><a href="mailto:academicplanningsystem@gmail.com?subject=Question%20about%20EduAdmin%20Pro">Write to us →</a></div>
       </div>
       <div className="foot"><a className="logo" href="#top"><b>EA</b><span>EduAdmin Pro</span></a><span>© {year} EduAdmin Pro</span></div>
      </div></footer>
    </div>
  )
}

function Timetable() {
  return (
    <div className="tt-grid" id="ttg">
      <span />
      {TIMETABLE_DAYS.map((d) => (
        <span key={d} className="h">
          {d}
        </span>
      ))}
      {timetable().map((row) => [
        <span key={row.time} className="tm">
          {row.time}
        </span>,
        ...row.cells.map((cell, i) => (
          <span key={`${row.time}-${i}`} className="c">
            {cell && (
              <span className={`p ${cell.tone}`}>
                {cell.subject}
                <small>{cell.batch}</small>
              </span>
            )}
          </span>
        )),
      ])}
    </div>
  )
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section className="sec" id="faq" style={{ paddingTop: '40px' }}>
      <div className="wrap faq-g">
        <div>
          <p className="kicker reveal">Questions</p>
          <h2 className="big mask" style={{ marginTop: '18px' }}>
            <span className="ln">
              <span>Good</span>
            </span>
            <span className="ln">
              <span>
                <em className="it">questions.</em>
              </span>
            </span>
          </h2>
        </div>
        <div>
          {FAQ.map((item, i) => (
            <div key={item.q} className="qa reveal" data-open={open === i ? '' : undefined}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {item.q}
                <span className="pm" aria-hidden="true">
                  +
                </span>
              </button>
              <div className="ans">
                <div>
                  <p>{item.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
