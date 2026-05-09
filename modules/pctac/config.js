/**
 * Configuration et constantes globales pour PC TAC
 */

// Clés de stockage
export const LOCAL_STORAGE_KEY = 'pcTacLogData';
export const TP_ASSOC_KEY = 'pcTacTpAssociations';
export const ADVERSARIES_KEY = 'pcTacAdversaries';
export const HOSTAGES_KEY = 'pcTacHostages';
export const FRIENDS_KEY = 'pcTacFriends';
export const PHOTOS_KEY = 'pcTacPhotos';
export const CUSTOM_PAX_KEY = 'pcTacCustomPax';

// Catégories de photos
export const PHOTO_CATEGORIES = [
    { id: 'hostage', label: 'Otages' },
    { id: 'location', label: 'Lieu' },
    { id: 'trap', label: 'Piégeages' },
    { id: 'neutralized', label: 'Adversaire' },
    { id: 'target', label: 'VL target' },
    { id: 'all', label: 'Toutes' }
];

// Couleurs pour le mode libre (Pax Libre)
export const FREE_MODE_COLORS = [
    { hex: '#800000', name: 'Bordeaux' },       
    { hex: '#B87333', name: 'Cuivre' },         
    { hex: '#FFDB58', name: 'Jaune Moutarde' }, 
    { hex: '#A3D900', name: 'Vert Lime' },      
    { hex: '#00FFFF', name: 'Cyan' },           
    { hex: '#000080', name: 'Bleu Marine' },    
    { hex: '#FF69B4', name: 'Rose Vif' },       
    { hex: '#FF8C00', name: 'Orange Foncée' },  
    { hex: '#8A2BE2', name: 'Bleu Violet' },    
    { hex: '#008080', name: 'Sarcelle' },       
    { hex: '#C0C0C0', name: 'Argent' },         
    { hex: '#ffffff', name: 'Blanc' }           
];

// Couleurs statiques pour le PDF et l'affichage (Mode Standard)
export const PDF_PAX_COLORS = {
    'Adversaire': { text: 'Adversaire', color: '#be1b09', fontColor: '#ffffff' },
    'Otage': { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' }, 
    'Civil': { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' }, 
    'Inter': { text: 'Inter', color: '#3498db', fontColor: '#ffffff' },
    'Nego': { text: 'Nego', color: '#2ecc71', fontColor: '#000000' },
    'Autre': { text: 'Autre', color: '#2d2d2d', fontColor: '#e0e0e0' }
};

// Paramètres QR Code
export const QR_BATCH_SIZE = 5;
export const LONG_PRESS_DELAY = 700;

// Exposition globale
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
window.PHOTO_CATEGORIES = PHOTO_CATEGORIES;
window.FREE_MODE_COLORS = FREE_MODE_COLORS;
window.PDF_PAX_COLORS = PDF_PAX_COLORS;
