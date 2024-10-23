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
const pass = process.env.PASSWORD || "password";
const fileSizeMax = process.env.MAX_FILE_SIZE || 1000;
const sessionKey = process.env.SESSION_KEY || "supersecretkeythatyoushouldchangerightnow";

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
app.use(session({
    secret: sessionKey,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60000 * 10 }
}));

app.use('/uploads', (req, res, next) => {
    if (req.url.endsWith('.mp4')) {
        next();
    } else {
        express.static('uploads')(req, res, next);
    }
});

app.get('/uploads/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'uploads', req.params.filename);

    fs.stat(filePath, (err, stats) => {
        if (err || !fs.existsSync(filePath)) {
            return res.status(404).send('File not found');
        }

        const fileSize = stats.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            });

            fs.createReadStream(filePath).pipe(res);
        }
    });
});

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
