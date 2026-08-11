const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'ictc_lms.db');

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      mobile TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      profile_updated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );
  `);

  migrate();

  db.run(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      duration TEXT DEFAULT '',
      trainer_name TEXT DEFAULT '',
      trainer_contact TEXT DEFAULT '',
      syllabus TEXT DEFAULT '[]',
      sessions TEXT DEFAULT '[]',
      materials TEXT DEFAULT '[]',
      assessments TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, course_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      assessment_title TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      answers TEXT DEFAULT '{}',
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seedAdmin();
  seedSampleData();

  saveDatabase();
  return db;
}

function migrate() {
  const studCols = db.exec("PRAGMA table_info(students)");
  const studNames = studCols.length ? studCols[0].values.map(r => r[1]) : [];
  if (!studNames.includes('avatar')) {
    db.run("ALTER TABLE students ADD COLUMN avatar TEXT DEFAULT ''");
  }
  const admCols = db.exec("PRAGMA table_info(admins)");
  const admNames = admCols.length ? admCols[0].values.map(r => r[1]) : [];
  if (!admNames.includes('avatar')) {
    db.run("ALTER TABLE admins ADD COLUMN avatar TEXT DEFAULT ''");
  }
}

function seedAdmin() {
  const adminCheck = db.exec("SELECT COUNT(*) AS cnt FROM admins WHERE username = 'admin'");
  if (adminCheck[0].values[0][0] === 0) {
    db.run(
      "INSERT INTO admins (username, password, full_name) VALUES (?, ?, ?)",
      ['admin', bcrypt.hashSync('admin123', 10), 'ICTC Administrator']
    );
  }
}

function seedSampleData() {
  const studentCheck = db.exec("SELECT COUNT(*) AS cnt FROM students WHERE student_id = 'ICTC-STU-001'");
  if (studentCheck[0].values[0][0] === 0) {
    db.run(
      "INSERT INTO students (student_id, password, full_name, email, mobile) VALUES (?, ?, ?, ?, ?)",
      ['ICTC-STU-001', bcrypt.hashSync('ictc2026', 10), 'Demo Student', 'demo@ictc.edu', '9876543210']
    );
  }

  const courseCheck = db.exec("SELECT COUNT(*) AS cnt FROM courses");
  if (courseCheck[0].values[0][0] === 0) {
    insertSeedCourses();
  }

  const enrollmentCheck = db.exec(
    "SELECT COUNT(*) AS cnt FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE s.student_id = 'ICTC-STU-001'"
  );
  if (enrollmentCheck[0].values[0][0] === 0) {
    const courseId = db.exec("SELECT id FROM courses ORDER BY id LIMIT 1");
    if (courseId.length > 0 && courseId[0].values.length > 0) {
      db.run("INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)", ['ICTC-STU-001', courseId[0].values[0][0]]);
    }
  }
}

function insertSeedCourses() {
  const courses = [
    {
      code: 'ICTC-PBE-101',
      title: 'Professional Business English',
      category: 'Communication',
      duration: '6 weeks',
      description: 'Build confident workplace communication: emails, meetings, presentations and reports in clear, professional English.',
      trainer_name: 'Mr. Moin Khan',
      trainer_contact: 'moin.khan@ictc.edu | +91 98765 43210',
      syllabus: [
        'Week 1 - Business writing basics',
        'Week 2 - Writing clear professional emails',
        'Week 3 - Participating in meetings',
        'Week 4 - Presentations and public speaking',
        'Week 5 - Report and proposal writing',
        'Week 6 - Final assessment & feedback'
      ],
      sessions: [
        { date: '2026-08-18', time: '10:00 - 11:30', topic: 'Introduction & writing basics', mode: 'Online', link: 'https://meet.google.com/ictc-pbe101' },
        { date: '2026-08-25', time: '10:00 - 11:30', topic: 'Email writing workshop', mode: 'Online', link: 'https://meet.google.com/ictc-pbe101' },
        { date: '2026-09-01', time: '10:00 - 11:30', topic: 'Meeting skills practice', mode: 'Onsite', link: '' },
        { date: '2026-09-08', time: '10:00 - 11:30', topic: 'Presentation lab', mode: 'Onsite', link: '' }
      ],
      materials: [
        { type: 'PDF', title: 'Email Writing Handbook', url: 'https://example.com/pbe/email-handbook.pdf' },
        { type: 'Video', title: 'Meeting Skills Masterclass', url: 'https://example.com/pbe/meeting-masterclass.mp4' },
        { type: 'Slides', title: 'Presentation Design Guide', url: 'https://example.com/pbe/presentation-guide.pdf' }
      ],
      assessments: [
        {
          title: 'Week 1 Knowledge Check',
          passing: 80,
          questions: [
            { q: 'Which is the best subject line for a formal email?', options: ['hi', 'Invoice #1024 - Payment Due 15 Sep', 'Need to talk', 'URGENT!!!'], correct: 1 },
            { q: 'What should an effective email do in the first line?', options: ['Apologize for everything', 'State the purpose clearly', 'Use informal greetings', 'Repeat the subject'], correct: 1 },
            { q: 'Which closing is most professional?', options: ['See ya', 'Best regards', 'Yours and forever', 'Later'], correct: 1 },
            { q: 'In a meeting, the best way to raise a point is...', options: ['Interrupt loudly', 'Wait for a pause and say it confidently', 'Never speak', 'Send a message during the call'], correct: 1 }
          ]
        }
      ]
    },
    {
      code: 'ICTC-DMF-101',
      title: 'Digital Marketing Fundamentals',
      category: 'Marketing',
      duration: '8 weeks',
      description: 'Learn SEO, social media, content marketing and campaign basics to promote a business online.',
      trainer_name: 'Ms. Sara Ali',
      trainer_contact: 'sara.ali@ictc.edu | +91 98765 43211',
      syllabus: [
        'Week 1 - What is digital marketing',
        'Week 2 - SEO fundamentals',
        'Week 3 - Social media strategy',
        'Week 4 - Content marketing',
        'Week 5 - Email & WhatsApp marketing',
        'Week 6 - Running ad campaigns',
        'Week 7 - Analytics & reporting',
        'Week 8 - Final assessment & feedback'
      ],
      sessions: [
        { date: '2026-08-20', time: '14:00 - 15:30', topic: 'Digital marketing overview', mode: 'Online', link: 'https://meet.google.com/ictc-dmf101' },
        { date: '2026-08-27', time: '14:00 - 15:30', topic: 'SEO workshop', mode: 'Online', link: 'https://meet.google.com/ictc-dmf101' },
        { date: '2026-09-03', time: '14:00 - 15:30', topic: 'Social media strategy', mode: 'Onsite', link: '' },
        { date: '2026-09-10', time: '14:00 - 15:30', topic: 'Ads & analytics', mode: 'Onsite', link: '' }
      ],
      materials: [
        { type: 'Video', title: 'SEO for Beginners', url: 'https://example.com/dmf/seo-basics.mp4' },
        { type: 'PDF', title: 'Social Media Playbook', url: 'https://example.com/dmf/social-playbook.pdf' },
        { type: 'Link', title: 'Marketing Analytics Dashboard', url: 'https://example.com/dmf/analytics' }
      ],
      assessments: [
        {
          title: 'Module 1 Knowledge Check',
          passing: 80,
          questions: [
            { q: 'What does SEO stand for?', options: ['Social Engagement Optimization', 'Search Engine Optimization', 'Site Enhancement Operation', 'Search Endpoint Overview'], correct: 1 },
            { q: 'Which platform is best for B2B networking?', options: ['TikTok', 'LinkedIn', 'Instagram', 'Snapchat'], correct: 1 },
            { q: 'What is a conversion in digital marketing?', options: ['A website error', 'A visitor completing a desired action', 'A type of virus', 'An email bounce'], correct: 1 },
            { q: 'Which tool is commonly used for website analytics?', options: ['Google Analytics', 'MS Paint', 'Calculator', 'Notepad'], correct: 0 }
          ]
        }
      ]
    },
    {
      code: 'ICTC-EDA-101',
      title: 'Advanced Excel & Data Analysis',
      category: 'Data',
      duration: '5 weeks',
      description: 'Master formulas, PivotTables, dashboards and data visualization using Microsoft Excel.',
      trainer_name: 'Mr. Ravi Kumar',
      trainer_contact: 'ravi.kumar@ictc.edu | +91 98765 43212',
      syllabus: [
        'Week 1 - Excel formulas & functions',
        'Week 2 - Lookups: VLOOKUP / XLOOKUP',
        'Week 3 - PivotTables & charts',
        'Week 4 - Dashboards & data visualization',
        'Week 5 - Final assessment & feedback'
      ],
      sessions: [
        { date: '2026-08-22', time: '09:30 - 11:00', topic: 'Formulas & functions', mode: 'Onsite', link: '' },
        { date: '2026-08-29', time: '09:30 - 11:00', topic: 'Lookup functions', mode: 'Online', link: 'https://meet.google.com/ictc-eda101' },
        { date: '2026-09-05', time: '09:30 - 11:00', topic: 'PivotTables hands-on', mode: 'Onsite', link: '' },
        { date: '2026-09-12', time: '09:30 - 11:00', topic: 'Build your dashboard', mode: 'Onsite', link: '' }
      ],
      materials: [
        { type: 'Slides', title: 'Excel Mastery Deck', url: 'https://example.com/eda/excel-deck.pdf' },
        { type: 'Video', title: 'PivotTable Crash Course', url: 'https://example.com/eda/pivot-crash.mp4' },
        { type: 'PDF', title: 'Practice Dataset', url: 'https://example.com/eda/practice-data.xlsx' }
      ],
      assessments: [
        {
          title: 'Excel Basics Check',
          passing: 80,
          questions: [
            { q: 'Which function finds a value in a vertical table?', options: ['SUM', 'VLOOKUP', 'AVERAGE', 'COUNTIF'], correct: 1 },
            { q: 'What tool is best for summarizing large data tables?', options: ['PivotTable', 'Bold text', 'Page break', 'Freeze panes'], correct: 0 },
            { q: 'Which function adds a range of numbers?', options: ['MEAN', 'TOTAL', 'SUM', 'ADD'], correct: 2 },
            { q: 'Which chart is best for comparing parts of a whole?', options: ['Line chart', 'Pie chart', 'Scatter plot', 'Waterfall'], correct: 1 }
          ]
        }
      ]
    }
  ];

  courses.forEach(c => {
    db.run(
      `INSERT INTO courses (code, title, category, description, duration, trainer_name, trainer_contact, syllabus, sessions, materials, assessments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.code, c.title, c.category, c.description, c.duration, c.trainer_name, c.trainer_contact,
        JSON.stringify(c.syllabus), JSON.stringify(c.sessions), JSON.stringify(c.materials), JSON.stringify(c.assessments)]
    );
  });
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb, saveDatabase };
