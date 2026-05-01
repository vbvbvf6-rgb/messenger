# Сетевой доступ к Vaibgram

## Способы подключения за пределами локальной сети

### 1. **Использование туннеля (ngrok) - быстро и просто**

Ngrok создаёт публичный URL для вашего локального сервера.

**Установка ngrok:**
```bash
# Windows PowerShell
winget install ngrok  # или скачайте с https://ngrok.com/download

# Регистрация (бесплатно)
ngrok config add-authtoken <ВАШ_ТОКЕН>
```

**Запуск туннеля:**
```bash
# Если сервер работает на http://localhost:8000
ngrok http 8000

# Ngrok выдаст URL типа: https://a1b2c3d4.ngrok.io
```

Затем вы можете открыть этот URL в браузере, и он перенаправит на ваш локальный сервер.

---

### 2. **Развёртывание на облачный сервис**

#### **Option A: Heroku (простой способ)**
```bash
# 1. Установить Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli

# 2. Login
heroku login

# 3. Создать приложение
heroku create my-vaibgram-app

# 4. Deploy
git push heroku main

# 5. Открыть приложение
heroku open
```

#### **Option B: Railway (минималист, примерно как Render)**
1. Зарегистрируйтесь на https://railway.app
2. Подключите GitHub репозиторий
3. Установите переменные окружения (если нужны)
4. Deploy произойдёт автоматически

#### **Option C: PythonAnywhere (для Python)**
1. https://www.pythonanywhere.com
2. Загрузите файлы через Web Interface или Git
3. Настройте WSGI приложение на главной странице
4. Откройте URL (например, `username.pythonanywhere.com`)

#### **Option D: DigitalOcean/Linode VPS (для полного контроля)**
```bash
# 1. Арендуйте сервер (5$/месяц)
# 2. SSH на сервер
ssh root@ВАШ_IP

# 3. Установить зависимости
apt update
apt install python3-pip python3-venv

# 4. Клонировать репозиторий
git clone <URL_РЕПО>
cd Messenger

# 5. Установить зависимости
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 6. Установить Gunicorn
pip install gunicorn

# 7. Запустить сервер
gunicorn -w 4 -b 0.0.0.0:8000 backend.main:app

# 8. Также нужен Nginx как reverse proxy (см. конфиг ниже)
```

**Nginx конфигурация (/etc/nginx/sites-available/default):**
```nginx
server {
    listen 80;
    server_name ВАШ_IP_ИЛИ_ДОМЕН;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Активировать конфиг:**
```bash
systemctl restart nginx
```

---

### 3. **Использование собственного доменного имени**

1. Купите домен (например, на Namecheap, GoDaddy)
2. Установите DNS записи на IP вашего сервера
3. Установите SSL сертификат (бесплатно через Let's Encrypt):

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

---

### 4. **Конфигурация для удалённого доступа в fly.toml**

Если вы используете Fly.io:
```toml
[app]
  kill_signal = "SIGTERM"
  kill_timeout = 5
  processes = []

[[services]]
  internal_port = 8000
  processes = ["app"]
  protocol = "tcp"
  
  [services.concurrency]
    hard_limit = 1000
    soft_limit = 800
    
  [[services.ports]]
    handlers = ["http"]
    port = 80
    
  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[env]
  SECRET_KEY = "your-secret-key"
```

**Deploy на fly.io:**
```bash
flyctl deploy
```

---

### 5. **Безопасность при доступе из внешней сети**

⚠️ **ВАЖНО:**
1. **Всегда используйте HTTPS** при доступе через интернет
2. **Меняйте SECRET_KEY** в `backend/routes.py` перед deployment
3. **Включите 2FA** для всех пользователей
4. **Используйте VPN** если это приватный сервер
5. **Регулярно обновляйте зависимости:**
```bash
pip install --upgrade -r requirements.txt
```

---

### 6. **Тестирование подключения**

После развёртывания, протестируйте:

1. **Откройте URL в браузере** (например, `https://yourdomain.com`)
2. **Авторизуйтесь** с вашим username и PIN
3. **Отправьте сообщение** и убедитесь, что Socket.IO работает
4. **Проверьте консоль браузера** (F12) на ошибки

---

### 7. **Решение проблем**

| Проблема | Решение |
|----------|---------|
| "Connection refused" | Убедитесь, что сервер запущен на 0.0.0.0:8000 |
| "WebSocket failed" | Проверьте nginx конфиг для WebSocket upgrade |
| "CORS error" | Обновите `allow_origins` в `backend/main.py` |
| "Socket.IO не работает" | Убедитесь, что python-socketio установлен |

---

### 8. **환境 переменные для Production**

Создайте `.env` файл:
```
SECRET_KEY=your-super-secret-key-change-me
DATABASE_URL=postgresql://user:password@host/db
DEBUG=False
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
```

Загрузите в приложение:
```python
import os
from dotenv import load_dotenv

load_dotenv()
SECRET_KEY = os.getenv("SECRET_KEY", "default-key")
```

---

## Рекомендуемый способ для больших аудиторий

**Fly.io (бесплатный tier)** или **Railway** - легко, бесплатно и удобно.

Просто свяжите GitHub репозиторий и он автоматически будет деплоиться!
