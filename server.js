const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const reminders = new Map();

const vapidKeys = {
    publicKey: 'BMJS6PIH33ZMeXwuF_pHGKEVs-qFZl0g4nMHZ_cvdK0Oifjpobc4OxYhBSh874PepmnKQtq6ZtsfUAR765XtH1Y',
    privateKey: 'FPru5vy0GQ0hhtVbg-E1UN4p7mip0uHCas-UeEXpC7s'
};

webpush.setVapidDetails(
    'mailto:im2high1@gmail.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

// Хранилище подписок
let subscriptions = [];

const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
    console.log('Клиент подключён:', socket.id);

socket.on('newReminder', (reminder) => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();
    if (delay <= 0) return;

    const timeoutId = setTimeout(() => {
        const payload = JSON.stringify({
            title: 'Напоминание!!',
            body: text,
            reminderId: id
        });
        subscriptions.forEach(sub => {
            webpush.sendNotification(sub, payload).catch(err =>
                console.error('Push error:', err));
        });

        const entry = reminders.get(id);
        if (entry) {
            entry.timeoutId = null;
            entry.fired = true;

            entry.cleanupId = setTimeout(() => {
                reminders.delete(id);
            }, 10 * 60 * 1000);
        }
    }, delay);

    reminders.set(id, { timeoutId, text, reminderTime, fired: false });
});


    socket.on('newTask', (task) => {
        // Рассылаем событие всем подключённым клиентам
        io.emit('taskAdded', task);

        // Формируем payload для push-уведомления
        const payload = JSON.stringify({
            title: 'Новая задача',
            body: task.text
        });

        // Отправляем push всем подписанным клиентам
        subscriptions.forEach(sub => {
            webpush.sendNotification(sub, payload).catch(err =>
                console.error('Push error:', err));
        });
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён:', socket.id);
    });
});

// Эндпоинты для push-подписок
app.post('/subscribe', (req, res) => {
    subscriptions.push(req.body);
    res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
    res.status(200).json({ message: 'Подписка удалена' });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

app.post('/snooze', (req, res) => {
    const reminderId = parseInt(req.query.reminderId, 10);
    if (!reminderId || !reminders.has(reminderId)) {
        return res.status(404).json({ error: 'Reminder not found' });
    }

    const reminder = reminders.get(reminderId);

    if (reminder.timeoutId) clearTimeout(reminder.timeoutId);
    if (reminder.cleanupId) clearTimeout(reminder.cleanupId);

    const newDelay = 1 * 60 * 1000;
    const newTimeoutId = setTimeout(() => {
        const payload = JSON.stringify({
            title: '⏰ Напоминание (отложено)',
            body: reminder.text,
            reminderId: reminderId
        });
        subscriptions.forEach(sub => {
            webpush.sendNotification(sub, payload).catch(err =>
                console.error('Push error:', err));
        });

        const entry = reminders.get(reminderId);
        if (entry) {
            entry.timeoutId = null;
            entry.fired = true;
            entry.cleanupId = setTimeout(() => {
                reminders.delete(reminderId);
            }, 10 * 60 * 1000);
        }
    }, newDelay);

    reminders.set(reminderId, {
        timeoutId: newTimeoutId,
        text: reminder.text,
        reminderTime: Date.now() + newDelay,
        fired: false,
        cleanupId: null
    });

    res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});