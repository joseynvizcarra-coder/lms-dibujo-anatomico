// auth.js - Sistema de Autenticación LMS Dibujo Anatómico
// Universidad Alberto Hurtado - Joselyn Vizcarra
// Versión conectada con Google Sheets

// ========================
// CONFIGURACIÓN API
// ========================

const API_URL = 'https://script.google.com/macros/s/AKfycbzPAp02xSdupXQE_LDrJdhPnh0mX1DRiYDfYTPCzQankJvsQ0YVTAJ8T1rooBd6N8J0gQ/exec';

// ========================
// FUNCIONES DE AUTENTICACIÓN
// ========================

/**
 * Autentica usuario con Google Sheets
 */
async function authenticateUser(username, password) {
    try {
        showLoading(true, 'Verificando credenciales...');
        
        const response = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const result = await response.json();
        
        if (result.success) {
            const userData = result.data;
            
            // Guardar datos del usuario en localStorage
            localStorage.setItem('currentUser', JSON.stringify(userData));
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('sessionStart', userData.loginTime);
            
            showLoading(false);
            return { success: true, user: userData };
        } else {
            showLoading(false);
            return { success: false, error: result.error };
        }
    } catch (error) {
        showLoading(false);
        console.error('Error de autenticación:', error);
        return { success: false, error: 'Error de conexión. Verifica tu internet.' };
    }
}

/**
 * Verifica si el usuario está autenticado
 */
function isAuthenticated() {
    return localStorage.getItem('isAuthenticated') === 'true';
}

/**
 * Obtiene los datos del usuario actual
 */
function getCurrentUser() {
    if (!isAuthenticated()) return null;
    try {
        return JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (error) {
        console.error('Error parsing user data:', error);
        logout();
        return null;
    }
}

/**
 * Cierra la sesión del usuario
 */
function logout() {
    const currentUser = getCurrentUser();
    if (currentUser) {
        logUserActivity('logout', currentUser);
    }

    // Limpiar datos de sesión
    localStorage.removeItem('currentUser');
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('sessionStart');

    // Redirigir a login
    window.location.href = 'login.html';
}

/**
 * Protege una página verificando autenticación
 */
function protectPage(requiredRole = null) {
    const currentUser = getCurrentUser();
    
    if (!isAuthenticated() || !currentUser) {
        // No autenticado, redirigir a login
        window.location.href = 'login.html';
        return false;
    }

    if (requiredRole && currentUser.role !== requiredRole) {
        // Rol incorrecto, redirigir según el rol actual
        switch(currentUser.role) {
            case 'instructor':
                if (window.location.pathname.includes('dashboard.html')) {
                    return true;
                }
                window.location.href = 'dashboard.html';
                break;
            case 'estudiante':
            case 'evaluador':
            default:
                if (window.location.pathname.includes('index.html') || 
                    window.location.pathname === '/' || 
                    window.location.pathname.includes('dibujo-anatomico-lms')) {
                    return true;
                }
                window.location.href = 'index.html';
                break;
        }
        return false;
    }

    return true;
}

// ========================
// SISTEMA DE PROGRESO
// ========================

/**
 * Obtiene el progreso de un estudiante desde Google Sheets
 */
async function getStudentProgress(username = null) {
    try {
        const userToQuery = username || getCurrentUser()?.username;
        if (!userToQuery) return null;

        const response = await fetch(`${API_URL}?action=getProgress&username=${encodeURIComponent(userToQuery)}`);
        const result = await response.json();

        if (result.success) {
            return result.data;
        } else {
            console.error('Error obteniendo progreso:', result.error);
            return null;
        }
    } catch (error) {
        console.error('Error de conexión al obtener progreso:', error);
        return null;
    }
}

/**
 * Actualiza el progreso de un módulo en Google Sheets
 */
async function updateModuleProgress(moduleNumber, progressData) {
    try {
        const currentUser = getCurrentUser();
        if (!currentUser || currentUser.role !== 'estudiante') return false;

        // Obtener progreso actual
        const currentProgress = await getStudentProgress();
        if (!currentProgress) return false;

        // Actualizar módulo específico
        currentProgress.modules[moduleNumber] = {
            ...currentProgress.modules[moduleNumber],
            ...progressData,
            lastUpdate: new Date().toISOString()
        };

        // Calcular progreso general
        const completedModules = Object.values(currentProgress.modules).filter(m => m.completed).length;
        currentProgress.overallProgress = Math.round((completedModules / 4) * 100);
        currentProgress.lastAccess = new Date().toISOString();

        // Calcular tiempo total
        currentProgress.totalTime = Object.values(currentProgress.modules).reduce((total, module) => {
            return total + (module.timeSpent || 0);
        }, 0);

        // Guardar en Google Sheets
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'saveProgress',
                username: currentUser.username,
                progress: currentProgress
            })
        });

        const result = await response.json();
        
        if (result.success) {
            // Registrar actividad
            logUserActivity('progress_update', currentUser, {
                module: moduleNumber,
                progress: progressData
            });
            return true;
        } else {
            console.error('Error guardando progreso:', result.error);
            return false;
        }
    } catch (error) {
        console.error('Error actualizando progreso:', error);
        return false;
    }
}

// ========================
// SISTEMA DE ACTIVIDADES
// ========================

/**
 * Registra una actividad del usuario en Google Sheets
 */
async function logUserActivity(action, userData, details = {}) {
    try {
        const activity = {
            action: 'logActivity',
            userId: userData.id || 0,
            username: userData.username,
            action: action,
            moduleId: details.moduleId || details.module || '',
            lessonId: details.lessonId || details.lesson || '',
            details: JSON.stringify(details),
            sessionId: userData.sessionId || generateSessionId()
        };

        // Enviar a Google Sheets (sin esperar respuesta para no bloquear UI)
        fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(activity)
        }).catch(error => {
            console.error('Error logging activity:', error);
        });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

// ========================
// FUNCIONES PARA DASHBOARD
// ========================

/**
 * Obtiene todos los estudiantes y su progreso (solo instructor)
 */
async function getAllStudentsProgress() {
    try {
        const currentUser = getCurrentUser();
        if (!currentUser || currentUser.role !== 'instructor') return null;

        const response = await fetch(`${API_URL}?action=getAllStudents`);
        const result = await response.json();

        if (result.success) {
            return result.data;
        } else {
            console.error('Error obteniendo estudiantes:', result.error);
            return null;
        }
    } catch (error) {
        console.error('Error de conexión al obtener estudiantes:', error);
        return null;
    }
}

/**
 * Obtiene actividades recientes (para dashboard)
 */
async function getRecentActivities(username = null, limit = 50) {
    try {
        let url = `${API_URL}?action=getActivities&limit=${limit}`;
        if (username) {
            url += `&username=${encodeURIComponent(username)}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
            return result.data;
        } else {
            console.error('Error obteniendo actividades:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error de conexión al obtener actividades:', error);
        return [];
    }
}

// ========================
// UTILIDADES
// ========================

/**
 * Genera un ID único de sesión
 */
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Actualiza la UI según el rol del usuario
 */
function updateUIForRole() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    // Mostrar/ocultar elementos según el rol
    const roleSpecificElements = document.querySelectorAll('[data-role]');
    roleSpecificElements.forEach(element => {
        const allowedRoles = element.dataset.role.split(',');
        if (allowedRoles.includes(currentUser.role)) {
            element.style.display = '';
        } else {
            element.style.display = 'none';
        }
    });

    // Actualizar información del usuario en la UI
    const userNameElements = document.querySelectorAll('.user-name');
    userNameElements.forEach(el => el.textContent = currentUser.fullName || currentUser.username);

    const userEmailElements = document.querySelectorAll('.user-email');
    userEmailElements.forEach(el => el.textContent = currentUser.email || '');

    // Actualizar elementos específicos por ID
    const userName = document.getElementById('userName');
    const userRole = document.getElementById('userRole'); 
    const userAvatar = document.getElementById('userAvatar');
    const instructorName = document.getElementById('instructorName');

    if (userName) userName.textContent = currentUser.fullName || currentUser.username;
    if (userRole) userRole.textContent = getRoleDisplayName(currentUser.role);
    if (userAvatar) {
        userAvatar.textContent = (currentUser.fullName || currentUser.username).charAt(0).toUpperCase();
    }
    if (instructorName) instructorName.textContent = currentUser.fullName || currentUser.username;
}

/**
 * Obtiene el nombre de visualización del rol
 */
function getRoleDisplayName(role) {
    const roleNames = {
        'instructor': 'Instructor',
        'estudiante': 'Estudiante',
        'evaluador': 'Evaluador'
    };
    return roleNames[role] || 'Usuario';
}

/**
 * Muestra/oculta indicador de carga
 */
function showLoading(show, message = 'Cargando...') {
    let loader = document.getElementById('globalLoader');
    
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'globalLoader';
            loader.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                           background: rgba(0,0,0,0.5); z-index: 9999; 
                           display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 2rem; border-radius: 10px; text-align: center;">
                        <div style="border: 3px solid #f3f3f3; border-top: 3px solid #2c5f66; 
                                   border-radius: 50%; width: 30px; height: 30px; 
                                   animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
                        <div>${message}</div>
                    </div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
            document.body.appendChild(loader);
        }
        loader.style.display = 'block';
    } else {
        if (loader) {
            loader.style.display = 'none';
        }
    }
}

// ========================
// INICIALIZACIÓN
// ========================

/**
 * Inicializa el sistema de autenticación cuando se carga la página
 */
function initializeAuth() {
    try {
        // Verificar si la sesión ha expirado (24 horas)
        const sessionStart = localStorage.getItem('sessionStart');
        if (sessionStart) {
            const sessionAge = Date.now() - new Date(sessionStart).getTime();
            const maxSessionAge = 24 * 60 * 60 * 1000; // 24 horas
            
            if (sessionAge > maxSessionAge) {
                logout();
                return;
            }
        }

        // Actualizar UI según el rol
        updateUIForRole();
    } catch (error) {
        console.error('Error initializing auth:', error);
        // En caso de error, limpiar datos corruptos
        localStorage.removeItem('currentUser');
        localStorage.removeItem('isAuthenticated');
    }
}

// ========================
// INICIALIZACIÓN AUTOMÁTICA
// ========================

// Inicializar cuando se carga el script
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuth);
} else {
    initializeAuth();
}