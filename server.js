const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getDb, saveDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = (file.originalname.match(/\.([a-zA-Z0-9]+)$/) || [])[1] || 'png';
    cb(null, Date.now() + '-' + uuidv4().slice(0, 8) + '.' + ext);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ictc-student-lms-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  res.locals.admin = (req.session && req.session.admin) ? req.session.admin : null;
  res.locals.student = (req.session && req.session.student) ? req.session.student : null;
  next();
});

// ================= HELPERS =================

function rows(sql, params = []) {
  const res = getDb().exec(sql, params);
  if (res.length === 0) return [];
  const cols = res[0].columns;
  return res[0].values.map(r => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = r[i]);
    return obj;
  });
}

function row(sql, params = []) {
  return rows(sql, params)[0] || null;
}

function parseJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function parseSyllabus(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function parseSessions(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const p = line.split('|').map(x => (x || '').trim());
    return { date: p[0] || '', time: p[1] || '', topic: p[2] || '', mode: p[3] || '', link: p[4] || '' };
  });
}

function parseMaterials(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const p = line.split('|').map(x => (x || '').trim());
    return { type: p[0] || 'Link', title: p[1] || '', url: p[2] || '#' };
  });
}

function parseAssessments(text) {
  const list = [];
  let current = null;
  String(text || '').split(/\r?\n/).forEach(line => {
    const s = line.trim();
    if (!s) return;
    if (s.startsWith('A:')) {
      const parts = s.slice(2).split('|').map(x => x.trim());
      current = { title: parts[0] || 'Assessment', passing: parseInt(parts[1], 10) || 80, questions: [] };
      list.push(current);
    } else if (s.startsWith('Q:') && current) {
      const p = s.slice(2).split('|').map(x => x.trim());
      if (p.length >= 6) {
        current.questions.push({
          q: p[0],
          options: p.slice(1, 5),
          correct: parseInt(p[5], 10)
        });
      }
    }
  });
  return list;
}

function getCourseProgress(course, studentId, courseId) {
  const attempts = rows(
    "SELECT * FROM attempts WHERE student_id = ? AND course_id = ?",
    [studentId, courseId]
  );
  const assessments = parseJson(course.assessments, []);
  const results = assessments.map(a => {
    const myAttempts = attempts.filter(t => t.assessment_title === a.title);
    const best = myAttempts.reduce((m, t) => (t.score > (m && m.score ? m.score : -1) ? t : m), null);
    return {
      title: a.title,
      passing: a.passing || 80,
      total: a.total,
      bestScore: best ? best.score : 0,
      attempts: myAttempts.length,
      passed: best ? best.passed === 1 : false,
      lastAttempted: myAttempts.length ? myAttempts[myAttempts.length - 1].attempted_at : null
    };
  });
  const passedCount = results.filter(r => r.passed).length;
  const progress = assessments.length ? Math.round((passedCount / assessments.length) * 100) : 0;
  return { assessments, results, passedCount, totalAssessments: assessments.length, progress };
}

function serializeSessionUser(usr) {
  if (usr) {
    return { id: usr.id, username: usr.username, full_name: usr.full_name, avatar: usr.avatar || '' };
  }
  return null;
}

function adminAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect('/admin/login');
}

function studentAuth(req, res, next) {
  if (req.session && req.session.student) return next();
  res.redirect('/login');
}

// ================= ROOT =================

app.get('/', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  if (req.session.student) return res.redirect('/dashboard');
  res.redirect('/login');
});

// ================= ADMIN AUTH =================

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = row("SELECT * FROM admins WHERE username = ?", [username]);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.render('admin/login', { error: 'Invalid credentials' });
  }
  req.session.admin = serializeSessionUser(admin);
  res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ================= ADMIN PROFILE =================

app.get('/admin/profile', adminAuth, (req, res) => {
  const admin = row("SELECT * FROM admins WHERE id = ?", [req.session.admin.id]);
  res.render('admin/profile', {
    admin,
    message: req.query.updated === '1' ? 'Profile updated' : null,
    error: req.query.error || null
  });
});

app.post('/admin/profile', adminAuth, (req, res) => {
  getDb().run("UPDATE admins SET full_name = ? WHERE id = ?", [req.body.full_name, req.session.admin.id]);
  saveDatabase();
  req.session.admin.full_name = req.body.full_name;
  res.redirect('/admin/profile?updated=1');
});

app.post('/admin/profile/avatar', adminAuth, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.redirect('/admin/profile?error=' + encodeURIComponent('Please choose an image file'));
  }
  const db = getDb();
  const admin = row("SELECT * FROM admins WHERE id = ?", [req.session.admin.id]);
  if (admin && admin.avatar) {
    const oldPath = path.join(__dirname, admin.avatar.replace(/^\/+/, ''));
    if (admin.avatar.startsWith('/uploads/') && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }
  }
  const avatarPath = '/uploads/avatars/' + req.file.filename;
  db.run("UPDATE admins SET avatar = ? WHERE id = ?", [avatarPath, req.session.admin.id]);
  saveDatabase();
  req.session.admin.avatar = avatarPath;
  res.redirect('/admin/profile?updated=1');
});

// ================= ADMIN DASHBOARD =================

app.get('/admin/dashboard', adminAuth, (req, res) => {
  const db = getDb();
  const stats = {
    students: rows("SELECT COUNT(*) AS cnt FROM students")[0].cnt,
    activeStudents: rows("SELECT COUNT(*) AS cnt FROM students WHERE is_active = 1")[0].cnt,
    courses: rows("SELECT COUNT(*) AS cnt FROM courses")[0].cnt,
    enrollments: rows("SELECT COUNT(*) AS cnt FROM enrollments")[0].cnt
  };
  const recentStudents = rows("SELECT * FROM students ORDER BY id DESC LIMIT 6");
  const courseList = rows(`
    SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count
    FROM courses c ORDER BY c.id DESC
  `);
  res.render('admin/dashboard', { admin: req.session.admin, stats, recentStudents, courseList });
});

// ================= ADMIN: STUDENTS =================

app.get('/admin/students', adminAuth, (req, res) => {
  const students = rows(`
    SELECT s.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.student_id) AS course_count,
      (SELECT COUNT(*) FROM attempts a JOIN enrollments e ON e.student_id = a.student_id WHERE e.student_id = s.student_id) AS attempt_count
    FROM students s ORDER BY s.id DESC
  `);
  res.render('admin/students', { admin: req.session.admin, students, message: req.query.message || null });
});

app.post('/admin/students/add', adminAuth, (req, res) => {
  const { full_name, email, mobile, count } = req.body;
  const db = getDb();
  const num = Math.min(parseInt(count, 10) || 1, 100);
  const ids = [];

  if (req.body.student_id) {
    const sid = String(req.body.student_id).trim().toUpperCase();
    const exists = row("SELECT COUNT(*) AS cnt FROM students WHERE student_id = ?", [sid]);
    if (exists.cnt > 0) {
      return res.redirect('/admin/students?message=' + encodeURIComponent('Student ID ' + sid + ' already exists'));
    }
    db.run("INSERT INTO students (student_id, password, full_name, email, mobile) VALUES (?, ?, ?, ?, ?)",
      [sid, bcrypt.hashSync(req.body.password || 'ictc2026', 10), full_name, email, mobile]);
    ids.push(sid);
  } else {
    for (let i = 0; i < num; i++) {
      const sid = 'ICTC-STU-' + Date.now().toString(36).toUpperCase().slice(-4) + '-' + uuidv4().slice(0, 4).toUpperCase();
      db.run("INSERT INTO students (student_id, password, full_name) VALUES (?, ?, ?)",
        [sid, bcrypt.hashSync('ictc2026', 10), full_name || '']);
      ids.push(sid);
    }
  }
  saveDatabase();
  res.redirect('/admin/students?message=' + encodeURIComponent('Created ' + ids.length + ' student account(s). Default password: ictc2026'));
});

app.post('/admin/students/delete', adminAuth, (req, res) => {
  const db = getDb();
  const sid = req.body.student_id;
  db.run("DELETE FROM enrollments WHERE student_id = ?", [sid]);
  db.run("DELETE FROM attempts WHERE student_id = ?", [sid]);
  db.run("DELETE FROM students WHERE student_id = ?", [sid]);
  saveDatabase();
  res.redirect('/admin/students?message=' + encodeURIComponent('Student removed'));
});

app.post('/admin/students/toggle', adminAuth, (req, res) => {
  const db = getDb();
  const student = row("SELECT * FROM students WHERE student_id = ?", [req.body.student_id]);
  if (student) {
    db.run("UPDATE students SET is_active = ? WHERE student_id = ?",
      [student.is_active === 1 ? 0 : 1, req.body.student_id]);
    saveDatabase();
  }
  res.redirect('/admin/students');
});

// ================= ADMIN: COURSES =================

app.get('/admin/courses', adminAuth, (req, res) => {
  const courses = rows(`
    SELECT c.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count,
      (SELECT COUNT(*) FROM enrollments e JOIN students s ON s.student_id = e.student_id WHERE e.course_id = c.id) AS student_count
    FROM courses c ORDER BY c.id DESC
  `);
  res.render('admin/courses', { admin: req.session.admin, courses, message: req.query.message || null });
});

app.get('/admin/courses/new', adminAuth, (req, res) => {
  res.render('admin/course-form', {
    admin: req.session.admin,
    course: null,
    fields: {
      syllabus: '', sessions: '', materials: '', assessments: ''
    }
  });
});

app.get('/admin/courses/:id/edit', adminAuth, (req, res) => {
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/admin/courses');
  res.render('admin/course-form', {
    admin: req.session.admin,
    course,
    fields: {
      syllabus: parseJson(course.syllabus, []).join('\n'),
      sessions: parseJson(course.sessions, []).map(s => [s.date, s.time, s.topic, s.mode, s.link].join(' | ')).join('\n'),
      materials: parseJson(course.materials, []).map(m => [m.type, m.title, m.url].join(' | ')).join('\n'),
      assessments: assessmentsToText(parseJson(course.assessments, []))
    }
  });
});

function assessmentsToText(list) {
  return list.map(a => {
    const header = 'A:' + a.title + '|' + (a.passing || 80);
    const qs = a.questions.map(q => 'Q:' + q.q + '|' + q.options.join('|') + '|' + q.correct);
    return [header].concat(qs).join('\n');
  }).join('\n');
}

app.post('/admin/courses/save', adminAuth, (req, res) => {
  const db = getDb();
  const b = req.body;
  const data = {
    code: String(b.code || '').trim().toUpperCase(),
    title: String(b.title || '').trim(),
    category: String(b.category || '').trim(),
    description: String(b.description || '').trim(),
    duration: String(b.duration || '').trim(),
    trainer_name: String(b.trainer_name || '').trim(),
    trainer_contact: String(b.trainer_contact || '').trim(),
    syllabus: JSON.stringify(parseSyllabus(b.syllabus)),
    sessions: JSON.stringify(parseSessions(b.sessions)),
    materials: JSON.stringify(parseMaterials(b.materials)),
    assessments: JSON.stringify(parseAssessments(b.assessments))
  };

  if (!data.code || !data.title) {
    return res.redirect('/admin/courses?message=' + encodeURIComponent('Course code and title are required'));
  }

  if (b.id) {
    db.run(`UPDATE courses SET code=?, title=?, category=?, description=?, duration=?, trainer_name=?, trainer_contact=?, syllabus=?, sessions=?, materials=?, assessments=? WHERE id=?`,
      [data.code, data.title, data.category, data.description, data.duration, data.trainer_name, data.trainer_contact,
        data.syllabus, data.sessions, data.materials, data.assessments, b.id]);
  } else {
    db.run(`INSERT INTO courses (code, title, category, description, duration, trainer_name, trainer_contact, syllabus, sessions, materials, assessments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.code, data.title, data.category, data.description, data.duration, data.trainer_name, data.trainer_contact,
        data.syllabus, data.sessions, data.materials, data.assessments]);
  }
  saveDatabase();
  res.redirect('/admin/courses?message=' + encodeURIComponent('Course saved successfully'));
});

app.post('/admin/courses/:id/delete', adminAuth, (req, res) => {
  const db = getDb();
  db.run("DELETE FROM enrollments WHERE course_id = ?", [req.params.id]);
  db.run("DELETE FROM attempts WHERE course_id = ?", [req.params.id]);
  db.run("DELETE FROM courses WHERE id = ?", [req.params.id]);
  saveDatabase();
  res.redirect('/admin/courses?message=' + encodeURIComponent('Course deleted'));
});

// ================= ADMIN: ENROLLMENT & PROGRESS =================

app.get('/admin/courses/:id/enroll', adminAuth, (req, res) => {
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/admin/courses');
  const students = rows("SELECT * FROM students ORDER BY full_name ASC");
  const enrolled = new Set(rows("SELECT student_id FROM enrollments WHERE course_id = ?", [req.params.id]).map(r => r.student_id));
  students.forEach(s => s.isEnrolled = enrolled.has(s.student_id));
  res.render('admin/enroll', { admin: req.session.admin, course, students, message: req.query.message || null });
});

app.post('/admin/courses/:id/enroll', adminAuth, (req, res) => {
  const db = getDb();
  const courseId = parseInt(req.params.id, 10);
  const selected = req.body.students ? (Array.isArray(req.body.students) ? req.body.students : [req.body.students]) : [];
  db.run("DELETE FROM enrollments WHERE course_id = ?", [courseId]);
  selected.forEach(sid => {
    db.run("INSERT OR IGNORE INTO enrollments (student_id, course_id) VALUES (?, ?)", [sid, courseId]);
  });
  saveDatabase();
  res.redirect('/admin/courses/' + courseId + '/enroll?message=' + encodeURIComponent('Enrollment updated'));
});

app.get('/admin/courses/:id/progress', adminAuth, (req, res) => {
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/admin/courses');
  const enrolled = rows(`
    SELECT s.student_id, s.full_name, s.email, e.enrolled_at
    FROM enrollments e JOIN students s ON s.student_id = e.student_id
    WHERE e.course_id = ? ORDER BY s.full_name ASC
  `, [req.params.id]);

  const rowsOut = enrolled.map(st => {
    const prog = getCourseProgress(course, st.student_id, parseInt(req.params.id, 10));
    return { student: st, ...prog };
  });

  res.render('admin/progress', { admin: req.session.admin, course, rows: rowsOut });
});

// ================= STUDENT AUTH =================

app.get('/login', (req, res) => {
  if (req.session.student) return res.redirect('/dashboard');
  res.render('student/login', { error: null });
});

app.post('/login', (req, res) => {
  const { student_id, password } = req.body;
  const student = row("SELECT * FROM students WHERE student_id = ?", [String(student_id || '').trim().toUpperCase()]);
  if (!student || student.is_active !== 1 || !bcrypt.compareSync(password, student.password)) {
    return res.render('student/login', { error: 'Invalid Student ID or password, or account is inactive' });
  }
  getDb().run("UPDATE students SET last_login = datetime('now') WHERE student_id = ?", [student.student_id]);
  saveDatabase();
  req.session.student = { student_id: student.student_id, full_name: student.full_name, email: student.email, avatar: student.avatar || '' };
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ================= STUDENT PROFILE =================

app.get('/profile', studentAuth, (req, res) => {
  const student = row("SELECT * FROM students WHERE student_id = ?", [req.session.student.student_id]);
  res.render('student/profile', {
    student,
    message: req.query.updated === '1' ? 'Profile updated' : null,
    error: req.query.error || null
  });
});

app.post('/profile', studentAuth, (req, res) => {
  getDb().run("UPDATE students SET full_name=?, email=?, mobile=?, profile_updated=1 WHERE student_id=?",
    [req.body.full_name, req.body.email, req.body.mobile, req.session.student.student_id]);
  saveDatabase();
  req.session.student.full_name = req.body.full_name;
  req.session.student.email = req.body.email;
  res.redirect('/profile?updated=1');
});

app.post('/profile/avatar', studentAuth, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.redirect('/profile?error=' + encodeURIComponent('Please choose an image file'));
  }
  const db = getDb();
  const student = row("SELECT * FROM students WHERE student_id = ?", [req.session.student.student_id]);
  if (student && student.avatar) {
    const oldPath = path.join(__dirname, student.avatar.replace(/^\/+/, ''));
    if (student.avatar.startsWith('/uploads/') && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }
  }
  const avatarPath = '/uploads/avatars/' + req.file.filename;
  db.run("UPDATE students SET avatar = ? WHERE student_id = ?", [avatarPath, req.session.student.student_id]);
  saveDatabase();
  req.session.student.avatar = avatarPath;
  res.redirect('/profile?updated=1');
});

app.use((err, req, res, next) => {
  const isUploadError = err instanceof multer.MulterError || /image file/i.test(err.message || '');
  if (isUploadError) {
    const back = String(req.originalUrl || '').startsWith('/admin') ? '/admin/profile' : '/profile';
    return res.redirect(back + '?error=' + encodeURIComponent(err.message || 'Upload failed'));
  }
  next(err);
});

// ================= STUDENT DASHBOARD =================

app.get('/dashboard', studentAuth, (req, res) => {
  const sid = req.session.student.student_id;
  const student = row("SELECT * FROM students WHERE student_id = ?", [sid]);
  const enrolled = rows(`
    SELECT c.*, e.enrolled_at FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ? ORDER BY e.id DESC
  `, [sid]);

  const courses = enrolled.map(c => {
    const prog = getCourseProgress(c, sid, c.id);
    return { course: c, ...prog };
  });

  const upcomingSessions = [];
  enrolled.forEach(c => {
    const sessions = parseJson(c.sessions, []);
    const future = sessions.filter(s => s.date && s.date >= new Date().toISOString().slice(0, 10));
    if (future.length) {
      upcomingSessions.push({ course: c.title, code: c.code, next: future[0] });
    }
  });
  upcomingSessions.sort((a, b) => a.next.date.localeCompare(b.next.date));

  res.render('student/dashboard', { student, courses, upcomingSessions });
});

// ================= STUDENT COURSE DETAILS =================

app.get('/courses/:id', studentAuth, (req, res) => {
  const sid = req.session.student.student_id;
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/dashboard');
  const enrolled = row("SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?", [sid, course.id]);
  if (!enrolled) return res.redirect('/dashboard');

  const data = {
    syllabus: parseJson(course.syllabus, []),
    sessions: parseJson(course.sessions, []),
    materials: parseJson(course.materials, []),
    assessments: parseJson(course.assessments, [])
  };
  const prog = getCourseProgress(course, sid, course.id);

  res.render('student/course', { student: req.session.student, course, data, prog });
});

// ================= STUDENT ASSESSMENTS =================

app.get('/courses/:id/assessment/:index', studentAuth, (req, res) => {
  const sid = req.session.student.student_id;
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/dashboard');
  const enrolled = row("SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?", [sid, course.id]);
  if (!enrolled) return res.redirect('/dashboard');

  const assessments = parseJson(course.assessments, []);
  const index = parseInt(req.params.index, 10);
  const assessment = assessments[index];
  if (!assessment) return res.redirect('/courses/' + course.id);

  const prior = rows("SELECT * FROM attempts WHERE student_id=? AND course_id=? AND assessment_title=? ORDER BY id DESC",
    [sid, course.id, assessment.title]);

  res.render('student/assessment', {
    student: req.session.student,
    course,
    index,
    assessment,
    prior: prior[0] || null
  });
});

app.post('/courses/:id/assessment/:index', studentAuth, (req, res) => {
  const sid = req.session.student.student_id;
  const course = row("SELECT * FROM courses WHERE id = ?", [req.params.id]);
  if (!course) return res.redirect('/dashboard');
  const enrolled = row("SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?", [sid, course.id]);
  if (!enrolled) return res.redirect('/dashboard');

  const assessments = parseJson(course.assessments, []);
  const index = parseInt(req.params.index, 10);
  const assessment = assessments[index];
  if (!assessment) return res.redirect('/courses/' + course.id);

  let score = 0;
  const answers = {};
  assessment.questions.forEach((q, i) => {
    const userAnswer = parseInt(req.body['q' + i], 10);
    answers[i] = Number.isInteger(userAnswer) ? userAnswer : -1;
    if (userAnswer === q.correct) score++;
  });

  const total = assessment.questions.length;
  const percentage = total ? Math.round((score / total) * 100) : 0;
  const passing = assessment.passing || 80;
  const passed = percentage >= passing;

  getDb().run("INSERT INTO attempts (student_id, course_id, assessment_title, score, total, passed, answers) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [sid, course.id, assessment.title, score, total, passed ? 1 : 0, JSON.stringify(answers)]);
  saveDatabase();

  res.render('student/result', {
    student: req.session.student,
    course,
    index,
    assessment,
    score,
    total,
    percentage,
    passing,
    passed
  });
});

// ================= START =================

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log('\n=============================================');
    console.log('  ICTC Student LMS is running!');
    console.log('  Web & Mobile: http://localhost:' + PORT);
    console.log('=============================================');
    console.log('  Admin login : admin / admin123');
    console.log('  Demo student: ICTC-STU-001 / ictc2026');
    console.log('=============================================\n');
  });
}

start().catch(console.error);
