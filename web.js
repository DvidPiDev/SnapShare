// SnapShare - Very fast Node.js and Express.js file sharing.

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import bodyParser from 'body-parser';
import session from 'express-session';
import fs from 'fs';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const port = process.env.PORT || 8700;
const pass = process.env.PASSWORD;
const fileSizeMax = process.env.MAX_FILE_SIZE;
const sessionKey = process.env.SESSION_KEY;

const trafficLogLive = fs.createWriteStream(path.join(__dirname, 'traffic.log'), { flags: 'a' });
const logFormat = '[ :date[iso] ] :remote-addr - :method ":url" :status (:response-time ms) - :user-agent';

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: fileSizeMax * 1048576 },
});

if (!fs.existsSync(path.join(__dirname, 'timers.json'))) {
    fs.writeFileSync(path.join(__dirname, 'timers.json'), JSON.stringify({}), 'utf8');
}

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

let deleteTimers = loadTimers();
function loadTimers() {
    const data = fs.readFileSync("timers.json");
    const timers = JSON.parse(data);

    for (const [filename, { deleteTime }] of Object.entries(timers)) {
        const timeRemaining = deleteTime - Date.now();
        if (timeRemaining > 0) {
            timers[filename].timerId = setTimeout(() => deleteFile(filename), timeRemaining);
        } else {
            deleteFile(filename);
        }
    }

    return timers;
}

function saveTimers() {
    const serializedTimers = Object.fromEntries(
        Object.entries(deleteTimers).map(([filename, { deleteTime }]) => [filename, { deleteTime }])
    );
    fs.writeFileSync("timers.json", JSON.stringify(serializedTimers, null, 2));
}

function deleteFile(filename) {
    const filePath = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        if (deleteTimers[filename]) {
            clearTimeout(deleteTimers[filename].timerId);
            delete deleteTimers[filename];
            saveTimers();
        }
    }
}

function getUploadedFiles() {
    return fs.readdirSync('uploads').filter(file => file);
}

function isAuthenticated(req, res, next) {
    if (req.session["isAuthenticated"]) {
        return next();
    }
    res.redirect('/login');
}

app.set('view engine', 'ejs');
app.use(morgan(logFormat, { stream: trafficLogLive }));
app.use('/assets', express.static('assets'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use(session({
    secret: sessionKey,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60000 * 10 }
}));

app.get('/', isAuthenticated, (req, res) => {
    res.render('upload', { files: getUploadedFiles() });
});

app.get('/login', (req, res) => {
    res.render('login', { error: false });
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === pass) {
        req.session.isAuthenticated = true;

        return res.redirect('/');
    }
    res.render('login', { error: true });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/upload', isAuthenticated, upload.single('file'), (req, res) => {
    const { deleteAfter, randomize } = req.body;
    let filename = req.file.originalname;

    if (randomize) {
        const randomString = Math.random().toString(36).substring(2, 15);
        filename = randomString + path.extname(req.file.originalname);
    }

    const filePath = path.join('uploads', filename);
    fs.rename(req.file.path, filePath, (err) => {
        if (err) {
            return res.status(500).send('Error saving file');
        }

        if (deleteAfter && deleteAfter !== 'never') {
            const deleteDelay = parseInt(deleteAfter) * 60 * 1000;
            const deleteTime = Date.now() + deleteDelay;
            const timerId = setTimeout(() => deleteFile(filename), deleteDelay);
            deleteTimers[filename] = { deleteTime, timerId };

            saveTimers();
        }

        res.redirect('/');
    });
});

app.post('/delete', isAuthenticated, (req, res) => {
    const { filename } = req.body;
    deleteFile(filename);
    res.redirect('/');
});

app.listen(port, () => {
    console.log("Running at http://0.0.0.0:" + port);
});