<?php
// list-backups.php — Liste les fichiers .encre disponibles pour un projet
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
if(!$projetId){
    http_response_code(400);
    echo '{"error":"Missing projet_id"}';
    exit;
}

$dir = __DIR__ . '/backups/' . $projetId;
if(!is_dir($dir)){
    echo json_encode(['fichiers' => []]);
    exit;
}

$fichiers = glob($dir . '/*.encre');
if(!$fichiers){
    echo json_encode(['fichiers' => []]);
    exit;
}

// Trier par date décroissante (plus récent en premier)
usort($fichiers, fn($a, $b) => filemtime($b) - filemtime($a));

$result = array_map(function($f) {
    $info = json_decode(file_get_contents($f), true);
    return [
        'fichier'      => basename($f),
        'sauvegarde_le'=> $info['sauvegarde_le'] ?? date('c', filemtime($f)),
        'nom'          => $info['nom'] ?? 'Projet',
        'nb_chapitres' => count($info['contenu']['chapitres'] ?? []),
        'taille'       => filesize($f),
    ];
}, $fichiers);

echo json_encode(['fichiers' => $result]);
