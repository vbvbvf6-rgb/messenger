"""
Integration guide for new economy and Deep Seek systems into existing backend
"""

# In backend/main.py, add these imports:
# ====================================
from .economy_routes import router as economy_router
from .deepseek import DeepSeekSetting, MessageAnalysis, analyze_message

# Add router to FastAPI app:
# ===========================
app.include_router(economy_router)

# Auto-initialize Deep Seek on user registration:
# ================================================
# In routes.py register endpoint, add:

@router.post("/register")
async def register(username: str, pin: str, db: Session = Depends(get_db)):
    """Register new user and initialize Deep Seek"""
    # ... existing registration code ...
    
    # After user creation, auto-enable Deep Seek
    deepseek_setting = DeepSeekSetting(
        user_id=user.id,
        enabled=True,
        sensitivity="medium"
    )
    db.add(deepseek_setting)
    
    # Initialize wallet
    from .currency import CurrencyWallet
    wallet = CurrencyWallet(user_id=user.id, balance=0)
    db.add(wallet)
    
    # Initialize tasks
    from .currency import UserTask, AvailableTask, PERMANENT_TASKS
    available_tasks = db.query(AvailableTask).all()
    if not available_tasks:
        for task_data in PERMANENT_TASKS:
            task = AvailableTask(**task_data)
            db.add(task)
        db.commit()
        available_tasks = db.query(AvailableTask).all()
    
    for available_task in available_tasks:
        user_task = UserTask(user_id=user.id, task_id=available_task.id)
        db.add(user_task)
    
    db.commit()
    # ... rest of registration response ...

# Integrate Deep Seek into message sending:
# ==========================================
# In sockets.py message_send handler, add:

async def on_message(data):
    """Handle incoming message with Deep Seek analysis"""
    # ... existing message handling code ...
    
    # Analyze message for threats
    threat_level, keywords, confidence = analyze_message(data['content'])
    
    # Store analysis
    analysis = MessageAnalysis(
        message_id=message.id,
        threat_level=threat_level.value,
        keywords=str(keywords),
        confidence=confidence,
        is_flagged=threat_level.value != 'safe'
    )
    db.add(analysis)
    db.commit()
    
    # Alert if critical
    if threat_level.value == 'critical':
        await emit_to_user(
            recipient_id,
            'security_alert',
            {
                'type': 'dangerous_message_detected',
                'message': 'Опасное сообщение было обнаружено Deep Seek',
                'keywords': keywords
            }
        )
    
    # ... rest of message broadcasting ...

# Update task progress on actions:
# ================================
# In sockets.py, update these events:

# Track messages sent
async def on_message(data):
    # ... message sending code ...
    from .currency import update_task_progress
    update_task_progress(db, user_id, 'send_messages')

# Track calls made
async def on_call_start(data):
    # ... call start code ...
    from .currency import update_task_progress
    update_task_progress(db, user_id, 'make_calls')

# Track friends added
async def on_friend_request_accept(data):
    # ... friend request code ...
    from .currency import update_task_progress
    update_task_progress(db, user_id, 'add_friends')

# Database Migrations (Alembic):
# ==============================
# Run: alembic revision --autogenerate -m "Add economy and deepseek"
# Then: alembic upgrade head

# Or manually execute these SQL commands:

SQL_MIGRATIONS = """
-- Deep Seek Tables
CREATE TABLE deepseek_settings (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    sensitivity VARCHAR(20) DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE message_analysis (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    message_id INTEGER UNIQUE NOT NULL,
    threat_level VARCHAR(20) DEFAULT 'safe',
    keywords LONGTEXT,
    confidence FLOAT DEFAULT 0.0,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- Currency Tables
CREATE TABLE currency_wallets (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    balance INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE available_tasks (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    task_type VARCHAR(50) NOT NULL,
    requirement INTEGER NOT NULL,
    reward INTEGER DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_tasks (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES available_tasks(id),
    UNIQUE KEY unique_user_task (user_id, task_id)
);

-- Gift Tables
CREATE TABLE gifts (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    emoji VARCHAR(10),
    description VARCHAR(200),
    cost INTEGER NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gift_transactions (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    gift_id INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL,
    message VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    FOREIGN KEY (gift_id) REFERENCES gifts(id)
);

-- Add indexes for performance
CREATE INDEX idx_user_id ON deepseek_settings(user_id);
CREATE INDEX idx_message_id ON message_analysis(message_id);
CREATE INDEX idx_wallet_user ON currency_wallets(user_id);
CREATE INDEX idx_task_user ON user_tasks(user_id);
CREATE INDEX idx_transaction_sender ON gift_transactions(sender_id);
CREATE INDEX idx_transaction_receiver ON gift_transactions(receiver_id);
"""

# Environment Variables (add to .env):
# ===================================
# DEEPSEEK_ENABLED=true
# DEEPSEEK_AUTO_ENABLE_ON_REGISTER=true
# DEEPSEEK_SENSITIVITY=medium
# CURRENCY_ENABLED=true
# GIFT_SHOP_ENABLED=true
# INITIAL_CURRENCY_BALANCE=0

# Testing:
# =======
# Test Deep Seek:
import requests
response = requests.post('http://localhost:8000/api/deepseek/analyze', json={
    'text': 'Выигрыш приз бесплатные деньги click here verify'
})
print(response.json())
# Expected: threat_level = 'critical'

# Test Currency:
response = requests.get('http://localhost:8000/api/wallet/balance', 
    headers={'Authorization': 'Bearer token'})
print(response.json())

# Test Tasks:
response = requests.get('http://localhost:8000/api/tasks',
    headers={'Authorization': 'Bearer token'})
print(response.json())

# Frontend Integration:
# ====================
# The frontend already has UI for these features:
# 1. Wallet panel in settings
# 2. Task list with progress bars
# 3. Gift shop modal
# 4. Deep Seek status indicator
# 
# API calls are made via JavaScript in static/script.js
# Make sure backend routes are properly registered!

# Verification Checklist:
# ======================
# ✓ New tables created in database
# ✓ Routes registered in main FastAPI app
# ✓ Deep Seek auto-enables on registration
# ✓ Wallet initializes for new users
# ✓ Tasks initialize and track progress
# ✓ Message analysis runs on send
# ✓ Critical threats trigger alerts
# ✓ Currency can be bought and spent
# ✓ Gifts can be sent and received
# ✓ Task rewards automatically credited
# ✓ All endpoints return proper JSON
# ✓ Error handling is robust
