// Global variables
let selectedOrganizationId = null;
let selectedMachineId = null;
let machineMarkers = {};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the map
    initMap();
    
    // Set up the organization selection dropdown
    setupOrganizationSelection();
});

// Organization selection functionality
function setupOrganizationSelection() {
    console.log("Configurando selección de organizaciones");
    
    // Añadir manejadores a los elementos existentes
    addOrganizationClickHandlers();
    
    // Configurar buscador de organizaciones
    setupOrganizationSearch();
    
    // También agregar un controlador de eventos al elemento padre para manejar delegación de eventos
    // Esto ayudará si los elementos se recrean dinámicamente
    document.getElementById('organizationList').addEventListener('click', function(e) {
        // Verificar si el elemento clicado o alguno de sus padres es un .organization-item
        const item = e.target.closest('.organization-item');
        if (item) {
            e.preventDefault();
            const orgId = item.getAttribute('data-org-id');
            const orgName = item.textContent.trim();
            
            console.log(`Organización seleccionada: ${orgName} (${orgId})`);
            
            // Update dropdown button with organization name but keep the icon
            const dropdownButton = document.getElementById('organizationDropdown');
            if (dropdownButton) {
                dropdownButton.innerHTML = `<i class="fas fa-building me-2"></i> ${orgName}`;
            } else {
                console.error("No se encontró el elemento dropdownButton");
            }
            
            // Save selected organization
            selectedOrganizationId = orgId;
            
            // Load machines for this organization
            loadMachines(orgId);
            
            // Cerrar menú desplegable
            const dropdown = bootstrap.Dropdown.getInstance(dropdownButton);
            if (dropdown) {
                dropdown.hide();
            }
        }
    });
}

// Configurar el buscador de organizaciones
function setupOrganizationSearch() {
    const searchInput = document.getElementById('orgSearchInput');
    if (!searchInput) {
        console.error("No se encontró el elemento de búsqueda");
        return;
    }
    
    // Manejar el evento de entrada para filtrar la lista
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        const organizationItems = document.querySelectorAll('.organization-item');
        const noResultsMessage = document.getElementById('noResultsMessage');
        let matchCount = 0;
        
        // Recorrer cada elemento y mostrar/ocultar según el término de búsqueda
        organizationItems.forEach(item => {
            const orgName = item.textContent.toLowerCase();
            const orgId = item.getAttribute('data-org-id');
            
            // Verificar si el nombre o ID de la organización contiene el término de búsqueda
            if (orgName.includes(searchTerm) || orgId.includes(searchTerm)) {
                item.parentElement.style.display = ''; // Mostrar este elemento
                matchCount++;
            } else {
                item.parentElement.style.display = 'none'; // Ocultar este elemento
            }
        });
        
        // Mostrar mensaje de "sin resultados" si no hay coincidencias
        if (noResultsMessage) {
            if (matchCount === 0 && searchTerm.length > 0) {
                noResultsMessage.classList.remove('d-none');
            } else {
                noResultsMessage.classList.add('d-none');
            }
        }
    });
    
    // Prevenir que el dropdown se cierre al hacer clic en el campo de búsqueda
    searchInput.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // Al abrir el dropdown, enfocar automáticamente el campo de búsqueda
    const dropdownButton = document.getElementById('organizationDropdown');
    if (dropdownButton) {
        dropdownButton.addEventListener('shown.bs.dropdown', function() {
            searchInput.focus();
        });
        
        // Limpiar la búsqueda cuando se cierra el dropdown
        dropdownButton.addEventListener('hidden.bs.dropdown', function() {
            searchInput.value = '';
            // Restaurar la visibilidad de todos los elementos
            const event = new Event('input');
            searchInput.dispatchEvent(event);
        });
    }
}

// Función auxiliar para añadir manejadores de clic a elementos de organización
function addOrganizationClickHandlers() {
    const organizationItems = document.querySelectorAll('.organization-item');
    console.log(`Encontrados ${organizationItems.length} elementos de organización`);
    
    organizationItems.forEach(item => {
        const orgId = item.getAttribute('data-org-id');
        const orgName = item.textContent.trim();
        console.log(`  - ${orgName} (${orgId})`);
    });
}

// Load machines for the selected organization
function loadMachines(organizationId) {
    console.log(`Cargando máquinas para la organización: ${organizationId}`);
    
    // Obtener referencias a los elementos del DOM
    const machineListContainer = document.getElementById('machineListContainer');
    const machineLoader = document.getElementById('machineLoader');
    const emptyMachineMessage = document.getElementById('emptyMachineMessage');
    const machineCountElement = document.getElementById('machineCount');
    
    // Verificar que los elementos existen
    if (!machineListContainer) {
        console.error("No se encontró el elemento machineListContainer");
        return;
    }
    
    // Clear previous machine selection
    selectedMachineId = null;
    
    // Show loading
    machineListContainer.innerHTML = '';
    
    if (machineLoader) {
        machineLoader.classList.remove('d-none');
    }
    
    if (emptyMachineMessage) {
        emptyMachineMessage.classList.add('d-none');
    }
    
    // Ocultar campo de búsqueda y mensaje de no resultados
    const machineSearchContainer = document.getElementById('machineSearchContainer');
    const noMachineResultsMessage = document.getElementById('noMachineResultsMessage');
    const machineSearchInput = document.getElementById('machineSearchInput');
    
    if (machineSearchContainer) {
        machineSearchContainer.classList.add('d-none');
    }
    
    if (noMachineResultsMessage) {
        noMachineResultsMessage.classList.add('d-none');
    }
    
    // Limpiar el campo de búsqueda
    if (machineSearchInput) {
        machineSearchInput.value = '';
    }
    
    // Clear map markers
    clearMapMarkers();
    
    // Reset machine details
    resetMachineDetails();
    
    // Fetch machines from API
    fetch(`/api/machines/${organizationId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar máquinas');
            }
            return response.json();
        })
        .then(machines => {
            console.log(`Recibidas ${machines.length} máquinas para la organización ${organizationId}`);
            
            // Guardar las máquinas cargadas para usarlas en otras funciones
            window.lastLoadedMachines = machines;
            
            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }
            
            if (machines.length === 0) {
                if (emptyMachineMessage) {
                    emptyMachineMessage.textContent = 'No hay máquinas disponibles para esta organización';
                    emptyMachineMessage.classList.remove('d-none');
                }
                
                if (machineCountElement) {
                    machineCountElement.textContent = '0';
                }
                return;
            }
            
            // Update machine count
            if (machineCountElement) {
                machineCountElement.textContent = machines.length;
            }
            
            // Mostrar campo de búsqueda si hay máquinas
            const machineSearchContainer = document.getElementById('machineSearchContainer');
            console.log("Elemento buscador de máquinas:", machineSearchContainer);
            
            if (machineSearchContainer) {
                console.log("Mostrando campo de búsqueda de máquinas");
                machineSearchContainer.classList.remove('d-none');
                
                // Configurar la búsqueda de máquinas
                setupMachineSearch(machines);
            } else {
                console.error("No se encontró el contenedor de búsqueda de máquinas (machineSearchContainer)");
            }
            
            // Render machines in the list
            renderMachineList(machines);
            
            // Add machines to map
            addMachinesToMap(machines);
        })
        .catch(error => {
            console.error('Error:', error);
            
            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }
            
            if (emptyMachineMessage) {
                emptyMachineMessage.textContent = 'Error al cargar máquinas: ' + error.message;
                emptyMachineMessage.classList.remove('d-none');
            }
        });
}

// Render the machine list
function renderMachineList(machines) {
    console.log(`Renderizando lista de ${machines.length} máquinas`);
    const machineListContainer = document.getElementById('machineListContainer');
    machineListContainer.innerHTML = '';
    
    // Optimización para rendimiento: crear un fragmento de documento
    // para evitar múltiples repaints en grandes cantidades de máquinas
    const fragment = document.createDocumentFragment();
    
    // Limitar número de máquinas mostradas inicialmente si hay muchas
    // y agregar un botón para cargar más si es necesario
    const CHUNK_SIZE = 50; // Cantidad máxima inicial
    const totalMachines = machines.length;
    let initialMachines = machines;
    let remainingMachines = [];
    
    if (totalMachines > CHUNK_SIZE) {
        console.log(`Optimizando renderizado para ${totalMachines} máquinas`);
        initialMachines = machines.slice(0, CHUNK_SIZE);
        remainingMachines = machines.slice(CHUNK_SIZE);
    }
    
    // Función para renderizar un conjunto de máquinas
    const renderMachinesChunk = (machinesList, container) => {
        machinesList.forEach(machine => {
            const machineItem = document.createElement('a');
            machineItem.href = '#';
            machineItem.className = 'list-group-item list-group-item-action machine-item';
            machineItem.setAttribute('data-machine-id', machine.id);
            machineItem.setAttribute('data-category', machine.category || '');
            machineItem.setAttribute('data-model', machine.model || '');
            machineItem.setAttribute('data-name', machine.name || '');
            
            const hasLocation = machine.location && machine.location.latitude && machine.location.longitude;
            
            // Create the HTML content for the item
            machineItem.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">${machine.name || 'Sin nombre'}</h6>
                    <small>${machine.category || 'Sin categoría'}</small>
                </div>
                <small class="d-block">Modelo: ${machine.model || 'Desconocido'}</small>
                <small class="d-block ${hasLocation ? 'text-success' : 'text-muted'}">
                    <i class="fas fa-${hasLocation ? 'map-marker-alt' : 'times-circle'}"></i>
                    ${hasLocation ? 'Ubicación disponible' : 'Sin ubicación'}
                </small>
            `;
            
            // Add click event to select this machine
            machineItem.addEventListener('click', function(e) {
                e.preventDefault();
                selectMachine(machine.id);
            });
            
            container.appendChild(machineItem);
        });
    };
    
    // Renderizar el primer conjunto de máquinas
    renderMachinesChunk(initialMachines, fragment);
    
    // Si hay más máquinas por cargar, agregar botón "Cargar más"
    if (remainingMachines.length > 0) {
        const loadMoreButton = document.createElement('button');
        loadMoreButton.className = 'btn btn-outline-primary btn-sm w-100 mt-2';
        loadMoreButton.textContent = `Cargar más máquinas (${remainingMachines.length} restantes)`;
        loadMoreButton.addEventListener('click', function() {
            this.textContent = 'Cargando...';
            this.disabled = true;
            
            // Simular una pequeña demora para que la UI pueda actualizarse
            setTimeout(() => {
                // Eliminar el botón "Cargar más"
                this.remove();
                
                // Renderizar el siguiente conjunto de máquinas
                renderMachinesChunk(remainingMachines, machineListContainer);
                
                console.log('Máquinas adicionales cargadas');
                
                // Actualizar búsqueda si hay un término activo
                const searchInput = document.getElementById('machineSearchInput');
                if (searchInput && searchInput.value.trim()) {
                    const event = new Event('input');
                    searchInput.dispatchEvent(event);
                }
            }, 50);
        });
        
        fragment.appendChild(loadMoreButton);
    }
    
    // Agregar todos los elementos al contenedor
    machineListContainer.appendChild(fragment);
}

// Select a machine to show details and alerts
function selectMachine(machineId) {
    console.log(`Seleccionando máquina: ${machineId}`);
    
    try {
        // Guardar el ID anterior de la máquina seleccionada para comparar si cambió
        const previousSelectedMachineId = selectedMachineId;
        
        // Remove active class from all machine items in the list
        const machineItems = document.querySelectorAll('.machine-item');
        if (machineItems && machineItems.length > 0) {
            machineItems.forEach(item => {
                if (item && item.classList) {
                    item.classList.remove('active');
                }
            });
        }
        
        // Add active class to selected machine in the list
        const selectedItem = document.querySelector(`.machine-item[data-machine-id="${machineId}"]`);
        if (selectedItem && selectedItem.classList) {
            selectedItem.classList.add('active');
        } else {
            console.warn(`No se encontró elemento para la máquina con ID: ${machineId}`);
        }
        
        // Save selected machine
        selectedMachineId = machineId;
        
        // Focus map on selected machine
        focusMapOnMachine(machineId);
        
        // Si tenemos máquinas cargadas y cambió la selección, actualizar el mapa
        if (previousSelectedMachineId !== selectedMachineId && window.lastLoadedMachines) {
            console.log("Actualizando marcadores del mapa con nueva selección");
            // Recargar los marcadores para reflejar la nueva selección
            addMachinesToMap(window.lastLoadedMachines);
        }
        
        // Load machine details
        loadMachineDetails(machineId);
        
        // Load machine alerts
        loadMachineAlerts(machineId);
    } catch (error) {
        console.error(`Error al seleccionar máquina ${machineId}:`, error);
    }
}

// Load details for the selected machine
function loadMachineDetails(machineId) {
    console.log(`Cargando detalles para máquina: ${machineId}`);
    
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');
    
    if (!machineDetailEmpty || !machineDetailContent) {
        console.error("No se encontraron los contenedores de detalles de máquina");
        return;
    }
    
    // Show loading
    machineDetailEmpty.textContent = 'Cargando detalles...';
    machineDetailEmpty.classList.remove('d-none');
    machineDetailContent.classList.add('d-none');
    
    // Fetch machine details from API
    fetch(`/api/machine/${machineId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar detalles de la máquina');
            }
            return response.json();
        })
        .then(machine => {
            console.log("Detalles de máquina recibidos:", machine);
            
            // Update machine details
            const machineName = document.getElementById('machineName');
            const machineModel = document.getElementById('machineModel');
            const machineCategory = document.getElementById('machineCategory');
            const machineLatitude = document.getElementById('machineLatitude');
            const machineLongitude = document.getElementById('machineLongitude');
            const machineLocationUpdate = document.getElementById('machineLocationUpdate');
            
            // Actualizar elementos solo si existen
            if (machineName) machineName.textContent = machine.name || 'Sin nombre';
            if (machineModel) machineModel.textContent = machine.model || 'Modelo desconocido';
            if (machineCategory) machineCategory.textContent = machine.category || 'Sin categoría';
            
            // Update location info
            if (machine.location) {
                if (machineLatitude) machineLatitude.textContent = machine.location.latitude || '-';
                if (machineLongitude) machineLongitude.textContent = machine.location.longitude || '-';
                
                const timestamp = machine.location.timestamp || machine.lastUpdated;
                if (machineLocationUpdate) {
                    machineLocationUpdate.textContent = timestamp ? 
                        new Date(timestamp).toLocaleString() : 'Desconocido';
                }
            } else {
                if (machineLatitude) machineLatitude.textContent = '-';
                if (machineLongitude) machineLongitude.textContent = '-';
                if (machineLocationUpdate) machineLocationUpdate.textContent = 'No disponible';
            }
            
            // Show content
            machineDetailEmpty.classList.add('d-none');
            machineDetailContent.classList.remove('d-none');
        })
        .catch(error => {
            console.error('Error:', error);
            if (machineDetailEmpty) {
                machineDetailEmpty.textContent = 'Error al cargar detalles: ' + error.message;
            }
        });
}

// Load alerts for the selected machine
function loadMachineAlerts(machineId) {
    console.log(`Cargando alertas para máquina: ${machineId}`);
    
    const alertListContainer = document.getElementById('alertListContainer');
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    
    if (!alertListContainer || !emptyAlertMessage) {
        console.error("No se encontraron los contenedores de alertas");
        return;
    }
    
    // Show loading
    alertListContainer.innerHTML = '';
    emptyAlertMessage.textContent = 'Cargando alertas...';
    emptyAlertMessage.classList.remove('d-none');
    
    // Fetch machine alerts from API
    fetch(`/api/machine/${machineId}/alerts`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar alertas');
            }
            return response.json();
        })
        .then(alerts => {
            console.log(`Recibidas ${alerts.length} alertas para la máquina ${machineId}`);
            
            if (alerts.length === 0) {
                emptyAlertMessage.textContent = 'No hay alertas para esta máquina';
                return;
            }
            
            // Hide empty message
            emptyAlertMessage.classList.add('d-none');
            
            // Render alerts in the list
            renderAlertList(alerts);
        })
        .catch(error => {
            console.error('Error:', error);
            if (emptyAlertMessage) {
                emptyAlertMessage.textContent = 'Error al cargar alertas: ' + error.message;
            }
        });
}

// Render the alert list
function renderAlertList(alerts) {
    console.log(`Renderizando lista de ${alerts.length} alertas`);
    
    const alertListContainer = document.getElementById('alertListContainer');
    if (!alertListContainer) {
        console.error("No se encontró el contenedor de lista de alertas");
        return;
    }
    
    alertListContainer.innerHTML = '';
    
    alerts.forEach(alert => {
        try {
            const alertItem = document.createElement('div');
            alertItem.className = 'list-group-item';
            
            // Determine severity class based on the John Deere severity levels
            // HIGH: rojo, MEDIUM: amarillo, LOW/DTC/UNKNOWN: gris, INFO: azul
            let severityClass = 'alert-severity-info';
            let severityBgClass = 'bg-severity-info';
            let severityIcon = 'info-circle';
            let severityText = 'Info';
            
            if (alert.severity) {
                const severityLower = String(alert.severity).toLowerCase();
                switch (severityLower) {
                    case 'high':
                        severityClass = 'alert-severity-high';
                        severityBgClass = 'bg-severity-high';
                        severityIcon = 'exclamation-circle';
                        severityText = 'Alto';
                        break;
                    case 'medium':
                        severityClass = 'alert-severity-medium';
                        severityBgClass = 'bg-severity-medium';
                        severityIcon = 'exclamation-triangle';
                        severityText = 'Medio';
                        break;
                    case 'low':
                        severityClass = 'alert-severity-low';
                        severityBgClass = 'bg-severity-low';
                        severityIcon = 'exclamation';
                        severityText = 'Bajo';
                        break;
                    case 'dtc':
                        severityClass = 'alert-severity-dtc';
                        severityBgClass = 'bg-severity-dtc';
                        severityIcon = 'cog';
                        severityText = 'DTC';
                        break;
                    case 'unknown':
                        severityClass = 'alert-severity-unknown';
                        severityBgClass = 'bg-severity-unknown';
                        severityIcon = 'question-circle';
                        severityText = 'Desconocido';
                        break;
                }
            }
            
            // Format timestamp
            let timestamp = 'Desconocido';
            if (alert.timestamp) {
                try {
                    timestamp = new Date(alert.timestamp).toLocaleString();
                } catch (e) {
                    console.warn(`Error al formatear timestamp: ${e.message}`);
                }
            }
            
            // Create the HTML content for the alert
            alertItem.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1 ${severityClass}">
                        <i class="fas fa-${severityIcon} me-2"></i>
                        ${alert.title || 'Alerta sin título'}
                        <span class="badge ${severityBgClass} ms-2">${severityText}</span>
                    </h6>
                    <small class="text-muted">${alert.status || 'Estado desconocido'}</small>
                </div>
                <p class="mb-1 small">${alert.description || 'Sin descripción'}</p>
                <div class="d-flex justify-content-between align-items-center mt-2">
                    <small class="text-muted">${timestamp}</small>
                    <small class="text-muted">Tipo: ${alert.type || 'Desconocido'}</small>
                </div>
            `;
            
            alertListContainer.appendChild(alertItem);
        } catch (error) {
            console.error("Error al renderizar alerta:", error);
        }
    });
}

// Configurar la búsqueda de máquinas
function setupMachineSearch(allMachines) {
    console.log("Configurando búsqueda para", allMachines.length, "máquinas");
    const searchInput = document.getElementById('machineSearchInput');
    const noResultsMessage = document.getElementById('noMachineResultsMessage');
    
    if (!searchInput) {
        console.error('No se encontró el elemento de búsqueda de máquinas');
        return;
    }
    
    // Guardar todas las máquinas para filtrarlas
    window.allMachines = allMachines;
    
    // Eliminar listeners anteriores para evitar duplicación
    searchInput.removeEventListener('input', handleMachineSearch);
    
    // Variables para optimización
    let debounceTimer;
    const DEBOUNCE_DELAY = 300; // ms
    
    // Manejar el evento de entrada para filtrar la lista con debounce
    searchInput.addEventListener('input', function() {
        // Cancelar el timer anterior
        clearTimeout(debounceTimer);
        
        // Mostrar un indicador de búsqueda en progreso
        const loadingIndicator = document.getElementById('machineSearchLoading');
        if (loadingIndicator) {
            loadingIndicator.classList.remove('d-none');
        }
        
        // Establecer un nuevo timer
        debounceTimer = setTimeout(() => {
            handleMachineSearch.call(this);
            
            // Ocultar el indicador de búsqueda
            if (loadingIndicator) {
                loadingIndicator.classList.add('d-none');
            }
        }, DEBOUNCE_DELAY);
    });
    
    // Función para manejar la búsqueda (definida fuera para poder eliminarla)
    function handleMachineSearch() {
        const searchTerm = this.value.toLowerCase().trim();
        const machineListContainer = document.getElementById('machineListContainer');
        
        console.log("Buscando máquinas con término:", searchTerm);
        
        // Si no hay término de búsqueda, mostrar todas las máquinas
        if (searchTerm === '') {
            // Limpiar y volver a renderizar todas las máquinas
            machineListContainer.innerHTML = '';
            renderMachineList(allMachines);
            noResultsMessage.classList.add('d-none');
            return;
        }
        
        // Optimización: Si hay demasiadas máquinas, usar un algoritmo de búsqueda más eficiente
        // que priorice coincidencias exactas primero
        let filteredMachines = [];
        
        // Prioridad 1: Coincidencias exactas en ID
        const exactIdMatches = allMachines.filter(machine => 
            machine.id.toString().toLowerCase() === searchTerm);
        filteredMachines.push(...exactIdMatches);
        
        // Prioridad 2: Coincidencias exactas en nombre
        if (searchTerm.length > 2) {  // Solo para términos de búsqueda significativos
            const exactNameMatches = allMachines.filter(machine => 
                !exactIdMatches.includes(machine) && 
                (machine.name || '').toLowerCase() === searchTerm);
            filteredMachines.push(...exactNameMatches);
        }
        
        // Prioridad 3: Coincidencias parciales
        const partialMatches = allMachines.filter(machine => {
            // Saltamos las máquinas que ya están incluidas por coincidencias exactas
            if (filteredMachines.includes(machine)) {
                return false;
            }
            
            const name = (machine.name || '').toLowerCase();
            const model = (machine.model || '').toLowerCase();
            const category = (machine.category || '').toLowerCase();
            const id = machine.id.toString().toLowerCase();
            
            return name.includes(searchTerm) || 
                   model.includes(searchTerm) || 
                   category.includes(searchTerm) ||
                   id.includes(searchTerm);
        });
        
        // Si hay demasiadas coincidencias parciales, limitamos para evitar problemas de rendimiento
        const MAX_RESULTS = 100;
        if (partialMatches.length > MAX_RESULTS) {
            console.log(`Limitando resultados parciales de ${partialMatches.length} a ${MAX_RESULTS}`);
            filteredMachines.push(...partialMatches.slice(0, MAX_RESULTS));
        } else {
            filteredMachines.push(...partialMatches);
        }
        
        console.log("Máquinas filtradas:", filteredMachines.length);
        
        // Actualizar la lista con las máquinas filtradas
        machineListContainer.innerHTML = '';
        
        if (filteredMachines.length > 0) {
            // Mostrar mensaje si se limitaron los resultados
            if (partialMatches.length > MAX_RESULTS) {
                const limitMessage = document.createElement('div');
                limitMessage.className = 'alert alert-info small mb-2';
                limitMessage.innerHTML = `<i class="fas fa-info-circle"></i> Mostrando ${filteredMachines.length} resultados. Refine su búsqueda para ver más máquinas.`;
                machineListContainer.appendChild(limitMessage);
            }
            
            renderMachineList(filteredMachines);
            noResultsMessage.classList.add('d-none');
        } else {
            noResultsMessage.classList.remove('d-none');
        }
    }
}

// Reset machine details
function resetMachineDetails() {
    console.log("Reseteando detalles de máquina");
    
    // Reset alerts
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    const alertListContainer = document.getElementById('alertListContainer');
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');
    
    if (emptyAlertMessage) {
        emptyAlertMessage.textContent = 'Seleccione una máquina para ver sus alertas';
        emptyAlertMessage.classList.remove('d-none');
    }
    
    if (alertListContainer) {
        alertListContainer.innerHTML = '';
    }
    
    // Reset machine details
    if (machineDetailEmpty) {
        machineDetailEmpty.classList.remove('d-none');
    }
    
    if (machineDetailContent) {
        machineDetailContent.classList.add('d-none');
    }
}
