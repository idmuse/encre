<?php
// get-backup.php — Retourne le contenu d'un fichier .encre spécifique
header('Access-Control-Allow-Origin: https://iletaitunefois.net');
header('Access-Control-Allow-Headers: Content-Type, X-Encre-Token');
header('Content-Type: application/json');

define('SECRET_TOKEN', 'encre_backup_2026_suz');

$token = $_SERVER['HTTP_X_ENCRE_TOKEN'] ?? '';
if($token !== SECRET_TOKEN){
    http_response_code(403);
    echo '{"error":"Unauthorized"}';
    exit;
}

$projetId = preg_replace('/[^a-z0-9\-]/', '', $_GET['projet_id'] ?? '');
$fichier  = preg_replace('/[^a-zA-Z0-9_\-\.]/', '', $_GET['fichier'] ?? '');

if(!$projetId || !$fichier){
    http_response_code(400);
    echo '{"error":"Missing params"}';
    exit;
}

// Sécurité : s'assurer que le fichier est bien dans le bon dossier
$path = realpath(__DIR__ . '/backups/' . $projetId . '/' . $fichier);
$base = realpath(__DIR__ . '/backups/' . $projetId);

if(!$path || !$base || strpos($path, $base) !== 0 || !file_exists($path)){
    http_response_code(404);
    echo '{"error":"File not found"}';
    exit;
}

echo file_get_contents($path);
