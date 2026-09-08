<?php
// backup.php — Sauvegarde des projets encre sur WHC
// Garde les 10 dernières sauvegardes par projet

header('Access-Control-Allow-Origin: https://iletaitunefois.net');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Encre-Token');
header('Content-Type: application/json');

if($_SERVER['REQUEST_METHOD'] === 'OPTIONS'){ http_response_code(200); exit; }
if($_SERVER['REQUEST_METHOD'] !== 'POST'){ http_response_code(405); echo '{"error":"Method not allowed"}'; exit; }

// Token de sécurité simple — change cette valeur et mets la même dans app.js
define('SECRET_TOKEN', 'encre_backup_2026_suz');

$token = $_SERVER['HTTP_X_ENCRE_TOKEN'] ?? '';
if($token !== SECRET_TOKEN){
    http_response_code(403);
    echo '{"error":"Unauthorized"}';
    exit;
}

$body = file_get_contents('php://input');
$data = json_decode($body, true);

if(!$data || empty($data['projet_id']) || empty($data['contenu'])){
    http_response_code(400);
    echo '{"error":"Invalid data"}';
    exit;
}

$projetId = preg_replace('/[^a-z0-9\-]/', '', $data['projet_id']);
$nom = preg_replace('/[^a-zA-Z0-9\-_ ]/', '', $data['nom'] ?? 'projet');
$nom = substr(str_replace(' ', '-', $nom), 0, 40);

// Dossier de backups
$dir = __DIR__ . '/backups/' . $projetId;
if(!is_dir($dir)) mkdir($dir, 0755, true);

// Nom du fichier avec timestamp
$ts = date('Y-m-d_H-i-s');
$fichier = "$dir/{$nom}_{$ts}.encre";

// Écrire le backup
file_put_contents($fichier, json_encode([
    'projet_id' => $projetId,
    'nom'       => $data['nom'] ?? '',
    'sauvegarde_le' => date('c'),
    'contenu'   => $data['contenu']
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

// Garder seulement les 10 derniers fichiers
$fichiers = glob("$dir/*.encre");
if(count($fichiers) > 10){
    usort($fichiers, fn($a,$b) => @filemtime($a) - @filemtime($b));
    $aEffacer = array_slice($fichiers, 0, count($fichiers) - 10);
    foreach($aEffacer as $f) { if(file_exists($f)) unlink($f); }
}

echo json_encode(['ok' => true, 'fichier' => basename($fichier)]);
